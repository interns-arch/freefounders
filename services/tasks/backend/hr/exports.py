"""Attendance downloads (PLAN.md §19.31): the rows of the computed attendance screens (a person's month, Live /
Daily, the Dashboard month) as spreadsheet rows. The views build the data exactly as for the screen (same scope,
same filters) and hand it here; `config.exports.export_file` writes the file (formulas neutralised)."""
from datetime import date

from django.utils import timezone

from config.exports import EXPORT_MAX

LABEL = {"present": "Present", "late": "Late", "half_day": "Half day", "absent": "Absent", "leave": "Leave",
         "holiday": "Holiday", "week_off": "Week off", "not_checked_in": "Not checked in"}
UNIFORM = {True: "Yes", False: "No"}

# The status tiles of Live / Daily (apps/web/src/features/hr/daily.tsx `matches`).
_IN = {"present", "late", "half_day"}
DAY_FILTERS = {
    "all": lambda r: True,
    "in": lambda r: r["status"] in _IN,
    "late": lambda r: bool(r["is_late"]) or r["status"] == "late",
    "missing": lambda r: r["status"] in ("not_checked_in", "absent"),
    "leave": lambda r: r["status"] == "leave",
    "off": lambda r: r["status"] in ("holiday", "week_off"),
    "out": lambda r: bool(r["check_out"]),
}


def _local(dt):
    return timezone.localtime(dt).replace(tzinfo=None) if dt else None


def _hours(minutes):
    return round((minutes or 0) / 60, 2) if minutes else None


def _flags(r):
    out = []
    if r.get("is_late") and r.get("status") != "late":
        out.append("Late")
    if r.get("is_early_checkout"):
        out.append("Left early")
    if r.get("missing_checkout"):
        out.append("No check-out")
    return ", ".join(out)


def month_days(data):
    """A person's month (services.monthly_report + the person): one row per day."""
    who = (data.get("user") or {}).get("name", "")
    header = ["Date", "Day", "Employee", "Status", "Check in", "Check out", "Hours", "Notes", "Uniform", "Holiday"]
    rows = []
    for d in data["days"]:
        day = date.fromisoformat(d["date"])
        rows.append([day, day.strftime("%a"), who, LABEL.get(d["status"] or "", "") if d["status"] else "Upcoming",
                     _local(d["check_in"]), _local(d["check_out"]), _hours(d["working_minutes"]), _flags(d),
                     UNIFORM.get(d.get("uniform_ok"), ""), d.get("holiday") or ""])
    return header, rows


def team_day_rows(data, bucket="all"):
    keep = DAY_FILTERS.get(bucket or "all", DAY_FILTERS["all"])
    header = ["Date", "Employee ID", "Name", "Department", "Designation", "Phone", "Status", "Check in", "Check out",
              "Hours", "Notes", "Uniform", "Remark"]
    day = date.fromisoformat(data["date"])
    rows = []
    for r in data["rows"]:
        if not keep(r):
            continue
        rows.append([day, r["employee_code"], r["name"], r["department"], r["designation"], r["phone"],
                     LABEL.get(r["status"] or "", "") if r["status"] else "Upcoming",
                     _local(r["check_in"]), _local(r["check_out"]), _hours(r["working_minutes"]), _flags(r),
                     UNIFORM.get(r.get("uniform_ok"), ""), r.get("note") or ""])
    return header, rows[:EXPORT_MAX]


# Dashboard sort keys (apps/web/src/features/hr/dashboard.tsx `value`).
_MONTH_SORT = {
    "name": lambda r: r["name"].lower(),
    "employee_code": lambda r: (r["employee_code"] or "").lower(),
    "present": lambda r: r["present_days"],
    "absent": lambda r: r["totals"]["absent"],
    "half_day": lambda r: r["totals"]["half_day"],
    "late": lambda r: r["late_marks"],
    "leave": lambda r: r["totals"]["leave"],
    "off": lambda r: r["totals"]["week_off"] + r["totals"]["holiday"],
    "hours": lambda r: r["working_minutes"],
}


def team_month_rows(data, sort="name", direction="asc"):
    key = _MONTH_SORT.get(sort or "name", _MONTH_SORT["name"])
    rows_in = sorted(data["rows"], key=lambda r: r["name"].lower())   # ties by name, as on the screen
    rows_in = sorted(rows_in, key=key, reverse=direction == "desc")
    header = ["Employee ID", "Name", "Department", "Designation", "Phone", "Active", "Present", "Absent", "Half day",
              "Late marks", "Leave", "Week off", "Holiday", "Hours"]
    rows = [[r["employee_code"], r["name"], r["department"], r["designation"], r["phone"],
             "Yes" if r["is_active"] else "No", r["present_days"], r["totals"]["absent"], r["totals"]["half_day"],
             r["late_marks"], r["totals"]["leave"], r["totals"]["week_off"], r["totals"]["holiday"], r["total_hours"]]
            for r in rows_in]
    return header, rows[:EXPORT_MAX]


LEAVE_COLUMNS = [
    ("Employee", lambda r: (r.get("user_detail") or {}).get("name", "")),
    ("Username", lambda r: (r.get("user_detail") or {}).get("username", "")),
    ("Leave type", "leave_type_name"),
    ("From", "start_date"),
    ("To", "end_date"),
    ("Days", "days"),
    ("Reason", "reason"),
    ("Status", "status_display"),
    ("Reviewed by", lambda r: (r.get("reviewed_by_detail") or {}).get("name", "")),
    ("Remarks", "remarks"),
    ("Reviewed at", "reviewed_at"),
    ("Applied on", "created_at"),
]

CORRECTION_COLUMNS = [
    ("Employee", lambda r: (r.get("user_detail") or {}).get("name", "")),
    ("Username", lambda r: (r.get("user_detail") or {}).get("username", "")),
    ("Date", "date"),
    ("Requested check in", "requested_check_in"),
    ("Requested check out", "requested_check_out"),
    ("Reason", "reason"),
    ("Status", "status_display"),
    ("Reviewed by", lambda r: (r.get("reviewed_by_detail") or {}).get("name", "")),
    ("Remarks", "remarks"),
    ("Requested on", "created_at"),
]

ATTENDANCE_COLUMNS = [
    ("Date", "date"),
    ("Employee", lambda r: (r.get("user_detail") or {}).get("name", "")),
    ("Status", "status_display"),
    ("Check in", "check_in"),
    ("Check out", "check_out"),
    ("Minutes worked", "working_minutes"),
    ("Late", "is_late"),
    ("Left early", "is_early_checkout"),
    ("No check-out", "missing_checkout"),
]
