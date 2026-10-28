"""Team 360 (PLAN.md §25): who sees whom, the batched tiles and one person's numbers.

Everything reads the request's company schema only (TENANCY rules, §14). Nothing here writes. The numbers come from
the helpers the other screens already use, so Team 360 can never disagree with them:
- day classification: hr.team.month_statuses / totals_for (Daily attendance, Dashboard)
- attendance %: present + late + half day / working days so far (Team performance, §17.5)
- task counts and the score: TaskViewSet._task_buckets / _person_rows (= /tasks/employees_report/?user=)
"""
from datetime import date, timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from accounts.access import is_admin, is_owner, scope_of, widest
from accounts.models import User

# The people-facing permissions whose scope opens Team 360 (attendance screens and approvals).
HR_KEYS = ("hr.live", "hr.daily", "hr.dashboard", "hr.reports", "hr.approve")
WORKED = ("present", "late", "half_day")
NO_ACCESS = "Team 360 is for owners, admins, HR and managers with a team."


# ------------------------------------------------------------------ who sees whom

def _has_reports(user) -> bool:
    return user.reports.filter(is_active=True).exists()


def scope(user) -> str | None:
    """How far this person sees on Team 360: 'company', 'department', 'team' or None (no tab)."""
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return None
    if is_owner(user) or is_admin(user):
        return "company"
    s = widest(*(scope_of(user, k) for k in HR_KEYS))
    tasks_scope = scope_of(user, "tasks.view")
    if tasks_scope in ("team", "department", "company"):
        s = widest(s, tasks_scope)
    reports = _has_reports(user)
    if reports:
        s = widest(s, "team")
    if s in ("company", "department"):
        return s
    return "team" if reports else None   # Team scope without anyone reporting = only themself: no tab


def may_open(user) -> bool:
    return scope(user) is not None


def people(user):
    """Active people this viewer may open (company: everyone; department: department + team; team: me + reports)."""
    s = scope(user)
    if s is None:
        raise PermissionDenied(NO_ACCESS)
    base = User.objects.filter(is_active=True)
    if s == "company":
        return base
    cond = Q(pk=user.pk) | Q(reporting_manager=user)
    if s == "department":
        cond |= Q(department=user.department)
    return base.filter(cond).distinct()


def person_or_403(viewer, pk):
    try:
        pk = int(pk)
    except (TypeError, ValueError):
        raise ValidationError({"id": "Pass a person id."})
    target = people(viewer).filter(pk=pk).first()
    if target is None:
        raise PermissionDenied("You cannot open this person.")
    return target


def areas() -> dict:
    """Plan areas (PLAN.md §24.1): an area not in the plan is left out of Team 360."""
    from tenancy.profile import module_on, plan_has
    return {"tasks": plan_has("tasks"), "attendance": plan_has("attendance"), "visitors": module_on("visitors")}


def need_area(area: str):
    from tenancy.profile import PLAN_AREAS, plan_has
    if not plan_has(area):
        raise PermissionDenied(f"{PLAN_AREAS[area][0]} is not in your plan. An owner can add it in Billing.")


# ------------------------------------------------------------------ periods

def month_bounds(day: date):
    first = day.replace(day=1)
    return first, (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)


PERIODS = ("this_week", "this_month", "last_month", "this_quarter", "custom")


def period(params):
    """(name, start, end) from ?range= (default this_month) and ?start=&end= for custom (at most 366 days)."""
    today = timezone.localdate()
    name = params.get("range") or "this_month"
    if name == "this_week":
        start = today - timedelta(days=today.weekday())
        return name, start, start + timedelta(days=6)
    if name == "last_month":
        end = today.replace(day=1) - timedelta(days=1)
        return name, end.replace(day=1), end
    if name == "this_quarter":
        q_first = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
        q_last = month_bounds(date(q_first.year, q_first.month + 2, 1))[1]
        return name, q_first, q_last
    if name == "custom":
        try:
            start = date.fromisoformat(params.get("start", ""))
            end = date.fromisoformat(params.get("end", ""))
        except ValueError:
            raise ValidationError({"range": "Custom needs start and end as YYYY-MM-DD."})
        if end < start:
            raise ValidationError({"range": "The end date is before the start date."})
        if (end - start).days > 366:
            raise ValidationError({"range": "Pick at most a year."})
        return name, start, end
    if name != "this_month":
        raise ValidationError({"range": f"Use one of: {', '.join(PERIODS)}."})
    return (name, *month_bounds(today))


# ------------------------------------------------------------------ facts

def _names():
    from hr.team import department_names
    return department_names()


def facts(u, names, managers=None) -> dict:
    manager = None
    if u.reporting_manager_id:
        m = (managers or {}).get(u.reporting_manager_id) or u.reporting_manager
        if m is not None:
            manager = {"id": m.pk, "name": m.get_full_name() or m.username}
    return {
        "id": u.pk,
        "name": u.get_full_name() or u.username,
        "username": u.username,
        "employee_code": u.employee_code,
        "designation": u.designation,
        "department": names.get(u.department, u.department or ""),
        "department_code": u.department,
        "manager": manager,
        "phone": u.whatsapp_phone,
    }


def _attendance_rate(days: dict, today: date):
    """{date: (status, rec)} -> (rate %, worked days, working days so far). Working day = not holiday / week-off."""
    working = worked = 0
    for d, (status, _rec) in days.items():
        if d > today or status in ("holiday", "week_off", None):
            continue
        if d == today and status == "not_checked_in":
            continue   # today is not over: not counted until they punch in
        working += 1
        if status in WORKED:
            worked += 1
    return (round(100 * worked / working, 1) if working else None), worked, working


def _late_days(days: dict) -> int:
    return sum(1 for status, rec in days.values() if status == "late" or (rec is not None and rec.is_late))


# ------------------------------------------------------------------ the tiles

def tiles(viewer) -> dict:
    """Everyone in scope with today's status and this month's numbers, in a fixed number of queries."""
    from hr.team import month_statuses

    users = list(people(viewer).select_related("reporting_manager").order_by("first_name", "last_name", "username"))
    names = _names()
    today = timezone.localdate()
    first, last = month_bounds(today)
    on = areas()
    ids = [u.pk for u in users]

    statuses = {}
    if on["attendance"] and users:
        statuses, _cal = month_statuses(users, first, min(last, today))

    tasks = {}
    if on["tasks"] and users:
        from crm.models import Task, TaskStatus
        now = timezone.now()
        rows = (Task.objects.filter(assigned_to_id__in=ids, deleted_at__isnull=True)
                .values("assigned_to_id")
                .annotate(open=Count("id", filter=~Q(status=TaskStatus.DONE)),
                          overdue=Count("id", filter=~Q(status=TaskStatus.DONE) & Q(due_at__lt=now)),
                          done=Count("id", filter=Q(status=TaskStatus.DONE, completed_at__date__range=(first, last)))))
        tasks = {r["assigned_to_id"]: r for r in rows}

    out = []
    for u in users:
        row = facts(u, names)
        row["is_self"] = u.pk == viewer.pk
        if on["attendance"]:
            days = statuses.get(u.pk, {})
            status, rec = days.get(today, (None, None))
            rate, worked, working = _attendance_rate(days, today)
            row["today"] = {
                "status": status,
                "check_in": rec.check_in if rec else None,
                "check_out": rec.check_out if rec else None,
                "is_late": bool(rec and rec.is_late),
            }
            row["month"] = {
                "attendance_rate": rate, "present_days": worked, "working_days": working,
                "late_days": _late_days(days),
                "leave_days": sum(1 for s, _ in days.values() if s == "leave"),
                "absent_days": sum(1 for d, (s, _) in days.items() if s == "absent" and d < today),
            }
        else:
            row["today"] = row["month"] = None
        if on["tasks"]:
            t = tasks.get(u.pk, {})
            row["tasks"] = {"open": t.get("open", 0), "overdue": t.get("overdue", 0), "done_this_month": t.get("done", 0)}
        else:
            row["tasks"] = None
        out.append(row)

    depts = sorted({(r["department_code"], r["department"]) for r in out if r["department_code"]}, key=lambda d: d[1].lower())
    return {
        "scope": scope(viewer),
        "areas": on,
        "today": today.isoformat(),
        "month": {"start": first.isoformat(), "end": last.isoformat()},
        "departments": [{"code": c, "name": n} for c, n in depts],
        "rows": out,
    }


# ------------------------------------------------------------------ one person

def header(viewer, u) -> dict:
    from accounts.access import listed_roles
    names = _names()
    row = facts(u, names)
    row.update({
        "email": u.email,
        "join_date": u.join_date.isoformat() if u.join_date else None,
        "is_active": u.is_active,
        "is_self": u.pk == viewer.pk,
        "roles": [r.name for r in listed_roles(u)] or [u.get_role_display()],
        "reports": u.reports.filter(is_active=True).count(),
    })
    return row


def _buckets(start: date, end: date):
    """Weeks (Monday-based, clipped to the period) up to 120 days; calendar months beyond."""
    out = []
    if (end - start).days <= 120:
        cur = start
        while cur <= end:
            stop = min(cur + timedelta(days=6 - cur.weekday()), end)
            out.append((cur, stop, cur.strftime("%d %b")))
            cur = stop + timedelta(days=1)
    else:
        cur = start
        while cur <= end:
            stop = min(month_bounds(cur)[1], end)
            out.append((cur, stop, cur.strftime("%b %Y")))
            cur = stop + timedelta(days=1)
    return out


def attendance_kpis(u, start: date, end: date) -> dict:
    from hr import services
    from hr.models import AttendanceCorrection, LeaveRequest
    from hr.team import month_statuses, totals_for

    today = timezone.localdate()
    days, _ = month_statuses([u], start, end)
    days = days[u.pk]
    rate, worked, working = _attendance_rate(days, today)
    totals = totals_for({d: v for d, v in days.items() if d <= today})
    with_minutes = [rec.working_minutes for _s, rec in days.values() if rec is not None and rec.working_minutes]
    regs = AttendanceCorrection.objects.filter(user=u, date__range=(start, end))
    reg_counts = {r["status"]: r["n"] for r in regs.values("status").annotate(n=Count("id"))}
    leaves = LeaveRequest.objects.filter(user=u, start_date__lte=end, end_date__gte=start)
    trend = []
    for b_start, b_end, label in _buckets(start, end):
        part = {d: v for d, v in days.items() if b_start <= d <= b_end}
        r, _w, n = _attendance_rate(part, today)
        trend.append({"label": label, "start": b_start.isoformat(), "end": b_end.isoformat(),
                      "attendance_rate": r, "working_days": n, "late_days": _late_days(part)})
    return {
        "attendance_rate": rate, "present_days": worked, "working_days": working,
        "late_days": _late_days({d: v for d, v in days.items() if d <= today}),
        "half_days": totals["totals"]["half_day"], "absent_days": totals["totals"]["absent"],
        "leave_days": totals["totals"]["leave"],
        "avg_minutes": round(sum(with_minutes) / len(with_minutes)) if with_minutes else None,
        "total_hours": totals["total_hours"],
        "regularizations": {"approved": reg_counts.get("approved", 0), "pending": reg_counts.get("pending", 0),
                            "rejected": reg_counts.get("rejected", 0)},
        "leave_requests": {"approved": leaves.filter(status="approved").count(),
                           "pending": leaves.filter(status="pending").count()},
        "leave_balances": services.leave_balances(u),
        "trend": trend,
    }


def change_request_rank(u, start: date, end: date) -> dict:
    """Where this person stands among everyone who asked to move a due date in the period (most first; §19.41)."""
    from crm.models import TaskChangeRequest

    counts = {}
    for uid, changes in (TaskChangeRequest.objects.filter(created_at__date__range=(start, end),
                                                          requested_by__is_active=True)
                         .values_list("requested_by_id", "changes")):
        if "due_at" in (changes or {}):
            counts[uid] = counts.get(uid, 0) + 1
    mine = counts.get(u.pk, 0)
    return {"requests": mine, "rank": (1 + sum(1 for n in counts.values() if n > mine)) if mine else None,
            "of": len(counts)}


def task_kpis(u, start: date, end: date) -> dict:
    from crm.models import Task, TaskStatus
    from crm.task_views import TaskViewSet

    now = timezone.now()
    today = timezone.localtime(now).date()
    vs = TaskViewSet()
    per, corrective = vs._task_buckets([u], start, end)
    row = vs._person_rows(per, corrective, {u.pk: u.get_full_name() or u.username}, start, end, now, today,
                          always_emit=True)[0]
    done = list(Task.objects.filter(assigned_to=u, deleted_at__isnull=True, status=TaskStatus.DONE,
                                    completed_at__date__range=(start, end)).values_list("completed_at", "due_at"))
    trend = []
    for b_start, b_end, label in _buckets(start, end):
        in_b = [(c, d) for c, d in done if b_start <= timezone.localtime(c).date() <= b_end]
        late = sum(1 for c, d in in_b if d and c > d)
        trend.append({"label": label, "start": b_start.isoformat(), "end": b_end.isoformat(),
                      "completed": len(in_b), "on_time": len(in_b) - late, "late": late})
    return {
        "assigned": row["total"], "completed": row["completed"], "in_time": row["in_time"], "delayed": row["delayed"],
        "overdue": row["overdue"], "pending": row["pending"] + row["in_progress"],
        "on_time_rate": row["on_time_rate"], "score": row["score"], "review": row.get("review"),
        "time_earned_minutes": row["time_earned_minutes"], "mistakes": row.get("mistakes", 0),
        "change_requests": change_request_rank(u, start, end),
        "trend": trend,
    }


def summary(viewer, u, params) -> dict:
    name, start, end = period(params)
    on = areas()
    return {
        "person": header(viewer, u),
        "period": {"range": name, "start": start.isoformat(), "end": end.isoformat()},
        "areas": on,
        "attendance": attendance_kpis(u, start, end) if on["attendance"] else None,
        "tasks": task_kpis(u, start, end) if on["tasks"] else None,
    }


def _dt(v):
    return timezone.localtime(v).isoformat() if v else None


def may_see_photos(viewer, u) -> bool:
    """Punch photos and check-in places only where the viewer already may see them (hr.views.managed_users)."""
    from hr.views import managed_users
    return u.pk == viewer.pk or managed_users(viewer).filter(pk=u.pk).exists()


def attendance_month(viewer, u, params) -> dict:
    from hr import services
    from hr.models import Attendance, AttendanceCorrection, LeaveRequest
    from hr.team import parse_month

    year, month, first, last = parse_month(params)
    data = services.monthly_report(u, year, month)
    photos = may_see_photos(viewer, u)
    if photos:
        places = {a.id: a for a in Attendance.objects.filter(user=u, date__range=(first, last)).select_related("location")}
        for d in data["days"]:
            rec = places.get(d.get("attendance_id"))
            d["place"] = ({"office": rec.location.name if rec.location else None,
                           "lat": rec.check_in_lat, "lng": rec.check_in_lng} if rec else None)
    else:
        for d in data["days"]:
            d["has_check_in_photo"] = d["has_check_out_photo"] = False
            d["place"] = None
    regs = (AttendanceCorrection.objects.filter(user=u, date__range=(first, last))
            .select_related("reviewed_by", "added_by").order_by("-date", "-id"))
    leaves = (LeaveRequest.objects.filter(user=u, start_date__lte=last, end_date__gte=first)
              .select_related("leave_type", "reviewed_by").order_by("-start_date"))
    name = lambda x: (x.get_full_name() or x.username) if x else None  # noqa: E731
    data.update({
        "user": {"id": u.pk, "name": u.get_full_name() or u.username},
        "can_see_photos": photos,
        "regularizations": [{
            "id": r.id, "date": r.date.isoformat(), "reason": r.get_reason_type_display(), "note": r.reason,
            "status": r.status, "status_display": r.get_status_display(),
            "source": "hr" if r.added_by_id else "request", "added_by": name(r.added_by),
            "reviewed_by": name(r.reviewed_by), "reviewed_at": _dt(r.reviewed_at), "remarks": r.remarks,
            "from_status": r.original_status, "to_status": r.applied_status,
        } for r in regs],
        "leaves": [{
            "id": lv.id, "type": lv.leave_type.name, "start_date": lv.start_date.isoformat(),
            "end_date": lv.end_date.isoformat(), "days": lv.leave_days(), "half_day": lv.half_day,
            "status": lv.status, "status_display": lv.get_status_display(), "reviewed_by": name(lv.reviewed_by),
            "remarks": lv.remarks,
        } for lv in leaves],
        "leave_balances": services.leave_balances(u),
    })
    return data


LIST_MAX = 100


def _task_row(t, now, chain_info=None):
    return {
        "id": t.pk, "code": t.code, "title": t.title, "status": t.status, "status_display": t.get_status_display(),
        "priority": t.priority, "due_at": t.due_at, "completed_at": t.completed_at,
        "overdue": bool(t.status != "done" and t.due_at and t.due_at < now),
        "on_time": (None if t.status != "done" or not t.due_at or not t.completed_at else t.completed_at <= t.due_at),
        "given_by": (t.created_by.get_full_name() or t.created_by.username) if t.created_by_id and t.created_by else None,
        **(chain_info or {}),
    }


def task_lists(viewer, u, params) -> dict:
    from crm.chain import depth_of, root_of
    from crm.models import Task, TaskStatus

    name, start, end = period(params)
    now = timezone.now()
    base = Task.objects.filter(assigned_to=u, deleted_at__isnull=True).select_related("created_by")
    open_qs = list(base.exclude(status=TaskStatus.DONE).order_by("due_at", "id")[:LIST_MAX + 1])
    open_qs.sort(key=lambda t: (not (t.due_at and t.due_at < now), t.due_at or now + timedelta(days=36500)))
    done_qs = list(base.filter(status=TaskStatus.DONE, completed_at__date__range=(start, end))
                   .order_by("-completed_at")[:LIST_MAX + 1])
    # Chains (§19.41): their tasks that are a part of another task or were split into parts (open ones first).
    split = Task.objects.filter(parent__assigned_to=u, parent__deleted_at__isnull=True, deleted_at__isnull=True)
    chain_qs = list(base.filter(Q(parent__isnull=False) | Q(pk__in=split.values("parent_id"))).distinct()
                    .order_by("status", "-created_at")[:30])
    chains = []
    for t in chain_qs:
        root = root_of(t)
        chains.append(_task_row(t, now, {
            "level": depth_of(t),
            "root": {"id": root.pk, "code": root.code, "title": root.title} if root.pk != t.pk else None,
            "parts": t.subtasks.filter(deleted_at__isnull=True).count(),
        }))
    judged = [r for r in (_task_row(t, now) for t in done_qs[:LIST_MAX]) if r["on_time"] is not None]
    return {
        "period": {"range": name, "start": start.isoformat(), "end": end.isoformat()},
        "open": [_task_row(t, now) for t in open_qs[:LIST_MAX]],
        "open_more": len(open_qs) > LIST_MAX,
        "completed": [_task_row(t, now) for t in done_qs[:LIST_MAX]],
        "completed_more": len(done_qs) > LIST_MAX,
        "chains": chains,
        "on_time_rate": round(100 * sum(1 for r in judged if r["on_time"]) / len(judged), 1) if judged else None,
    }


def visits(viewer, u, params) -> dict:
    from visitors.models import Visit

    name, start, end = period(params)
    rows = (Visit.objects.filter(host=u, created_at__date__range=(start, end)).select_related("location")
            .order_by("-created_at")[:200])
    return {
        "period": {"range": name, "start": start.isoformat(), "end": end.isoformat()},
        # No visitor mobile, ID or photo here: who came, from where, why and when.
        "rows": [{
            "id": v.pk, "name": v.name, "company": v.company, "purpose": v.purpose, "people": v.people,
            "status": v.status, "status_display": v.get_status_display(),
            "location": v.location.name if v.location else None,
            "check_in_at": _dt(v.check_in_at), "check_out_at": _dt(v.check_out_at), "created_at": _dt(v.created_at),
        } for v in rows],
    }
