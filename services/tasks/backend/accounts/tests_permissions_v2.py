"""Every feature is its own permission (PLAN.md §19.19): the catalogue, the one-time upgrade of existing roles
(nobody loses anything), and each module refusing a role without its permission."""
import importlib
import uuid
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts import access
from accounts.models import AccessGrant, AccessRole, Role, User, UserAccessRole
from accounts.permissions import LEGACY_ROLE_CAPABILITIES, ROLE_CAPABILITIES
from accounts.tests_platform import JWKS, token

# What each broad permission covered before, and the permissions it became (the founder's list, 2026-10-12).
COVERED = {
    "hr.manage": {"hr.approve_all", "hr.live_all", "hr.daily_all", "hr.dashboard_all", "hr.reports_all", "hr.import",
                  "hr.mark", "hr.settings", "payroll.run", "payroll.salaries"},
    "tasks.assign": {"groups.create", "templates.manage", "mistakes.log", "sops.manage", "links.manage"},
    "settings.manage": {"notices.publish", "holidays.manage", "tasks.settings", "mistakes.settings"},
    "tasks.view_all": {"tasks.bin", "tasks.team_performance", "tasks.reports", "mistakes.review_all",
                       "hr.live_all", "hr.daily_all", "hr.dashboard_all", "hr.reports_all"},
    "tasks.view_department": {"tasks.reports", "mistakes.review_department"},
    "hr.approve": {"hr.live_department", "hr.daily_department", "hr.dashboard_department", "hr.reports_department"},
}
EVERYONE = {"attendance.punch", "attendance.self", "leave.self", "holidays.view", "payroll.self", "notices.view",
            "links.view", "mistakes.view", "directory.view", "notifications.view",
            "visitors.invite"}  # catalogue version 3 (PLAN.md §22)


def covers(caps, cap) -> bool:
    """`caps` include `cap`, or the same permission at a wider scope."""
    if cap in caps:
        return True
    if cap not in access._SCOPED_CAP:
        return False
    key, scope = access._SCOPED_CAP[cap]
    have = dict(access.grants_from_capabilities(caps)).get(key)
    return have is not None and access.SCOPES.index(have) >= access.SCOPES.index(scope)


class CatalogueTests(TestCase):
    def test_every_key_is_valid_and_gives_its_own_capabilities(self):
        seen = {}
        for p in access.catalogue():
            self.assertTrue(p["label"] and p["group"] and p["description"], p["key"])
            scopes = p["scopes"] or [""]
            for scope in scopes:
                self.assertTrue(access.valid_grant(p["key"], scope), (p["key"], scope))
                caps = access.capabilities_from_grants([(p["key"], scope)])
                self.assertEqual(len(caps), 1, (p["key"], scope))
                cap = caps.pop()
                self.assertNotIn(cap, seen, f"{cap} is given by both {seen.get(cap)} and {p['key']}")
                seen[cap] = p["key"]
        self.assertFalse(access.valid_grant("tasks.fly", ""))
        self.assertFalse(access.valid_grant("hr.live", "own"), "no Own scope on other people's attendance")

    def test_upgrade_rules_name_real_permissions(self):
        known = {p["key"] for p in access.catalogue()} | set(access.RETIRED)
        for p in access.catalogue():
            for rule in p.get("upgrade", []):
                if "from" in rule:
                    self.assertIn(rule["from"], known, p["key"])
                if p["scopes"] and "scope" in rule:
                    self.assertIn(rule["scope"], p["scopes"], p["key"])

    def test_old_keys_keep_working(self):
        self.assertTrue(access.valid_grant("hr.manage", ""))
        self.assertTrue(access.valid_grant("hr.approve", ""), "a blank scope from before means department")
        self.assertEqual(access.capabilities_from_grants([("hr.approve", "")]), {"hr.approve"})
        self.assertEqual(access.capabilities_from_grants([("hr.manage", "")]), COVERED["hr.manage"])
        self.assertNotIn("hr.manage", {p["key"] for p in access.catalogue()}, "not offered in the role builder any more")

    def test_publishes_version_descriptions_and_rules(self):
        api = APIClient()
        with override_settings(PLATFORM_JWKS=JWKS):
            api.credentials(HTTP_AUTHORIZATION=f"Bearer {token('platform', {}, aud='tasks-internal')}")
            res = api.get("/api/internal/permissions")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["version"], 3)
        self.assertEqual(res.data["retired"], ["hr.manage"])
        live = next(p for p in res.data["permissions"] if p["key"] == "hr.live")
        self.assertEqual(live["scopes"], ["team", "department", "company"])
        self.assertTrue(live["description"])
        self.assertIn({"from": "hr.manage", "scope": "company"}, live["upgrade"])


class UpgradeTests(TestCase):
    def test_every_built_in_role_keeps_every_old_power(self):
        for role, old in LEGACY_ROLE_CAPABILITIES.items():
            new = ROLE_CAPABILITIES[role]
            with self.subTest(role):
                self.assertTrue(set(old) - {"hr.manage", "hr.approve"} <= new, "old capability strings still there")
                if "hr.approve" in old:   # department, or wider when they were also HR administrators
                    self.assertTrue({"hr.approve", "hr.approve_all"} & new)
                self.assertTrue(EVERYONE <= new)
                for broad, became in COVERED.items():
                    if broad in old:
                        self.assertEqual({c for c in became if not covers(new, c)}, set(), broad)
                if role in (Role.ADMIN, Role.SUPER_ADMIN):
                    self.assertTrue({"leads.delete", "leads.rules"} <= new)
                else:
                    self.assertFalse({"leads.delete", "leads.rules"} & new)

    def test_nothing_extra_for_plain_roles(self):
        self.assertEqual(ROLE_CAPABILITIES[Role.RIDER], {"tasks.view_own"} | EVERYONE)
        self.assertNotIn("hr.approve", ROLE_CAPABILITIES[Role.SALES_EXECUTIVE])

    def test_upgrade_is_once_and_leaves_other_apps_roles_alone(self):
        self.assertEqual(access.upgrade_grants({}, 3), {}, "a role for another app gets no Tasks permissions")
        new = access.upgrade_grants({"hr.manage": "", "hr.approve": ""}, 2)
        self.assertNotIn("hr.manage", new)
        self.assertEqual(new["hr.approve"], "company")
        self.assertEqual(new["hr.live"], "company")
        self.assertEqual(access.upgrade_grants(new, 2, from_version=2), new, "already in today's catalogue")

    def test_the_data_migration_upgrades_existing_roles(self):
        migration = importlib.import_module("accounts.migrations.0021_fine_grained_permissions")
        hr = AccessRole.objects.create(code="old-hr", name="Old HR", level=2)
        for permission, scope in (("hr.manage", ""), ("hr.approve", ""), ("tasks.view", "team")):
            AccessGrant.objects.create(role=hr, permission=permission, scope=scope)
        other_app = AccessRole.objects.create(code="assets-only", name="Assets only", level=3)
        from django.apps import apps
        migration.forwards(apps, None)
        grants = dict(AccessGrant.objects.filter(role=hr).values_list("permission", "scope"))
        self.assertNotIn("hr.manage", grants)
        self.assertEqual(grants["hr.approve"], "company")
        self.assertEqual(grants["hr.daily"], "company")
        self.assertEqual(grants["payroll.run"], "")
        self.assertEqual(grants["attendance.punch"], "")
        self.assertEqual(grants["tasks.view"], "team")
        self.assertFalse(AccessGrant.objects.filter(role=other_app).exists())


def service():
    return token("platform", {}, aud="tasks-internal")


@override_settings(PLATFORM_JWKS=JWKS)
class OlderPlatformPushTests(TestCase):
    def setUp(self):
        access.forget()
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {service()}")
        self.person = uuid.uuid4()
        self.u = User.objects.create_user("p", "p@x.com", "pass@12345", platform_person_id=self.person)

    def tearDown(self):
        access.forget()

    def test_a_push_in_the_old_catalogue_keeps_the_same_powers(self):
        rid = uuid.uuid4()
        res = self.api.put("/api/internal/access", {
            "version": 1,
            "roles": [{"id": str(rid), "name": "HR", "level": 2,
                       "grants": [{"permission": "hr.manage", "scope": ""}, {"permission": "tasks.view", "scope": "team"}]}],
            "people": [{"personId": str(self.person), "roleIds": [str(rid)]}],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        caps = access.capabilities(User.objects.get(pk=self.u.pk))
        self.assertTrue(COVERED["hr.manage"] <= caps)
        self.assertTrue(EVERYONE <= caps)
        stored = set(AccessGrant.objects.filter(role__platform_role_id=rid).values_list("permission", flat=True))
        self.assertNotIn("hr.manage", stored)


class EnforcementTests(TestCase):
    """A role with exactly one permission gets that feature; without it the API answers 403."""

    def setUp(self):
        access.forget()
        self.boss = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.ADMIN, department="sales")
        self.me = User.objects.create_user("me", "me@x.com", "pass@12345", department="sales")
        self.report = User.objects.create_user("rep", "rep@x.com", "pass@12345", department="warehouse",
                                               reporting_manager=self.me)
        self.colleague = User.objects.create_user("col", "col@x.com", "pass@12345", department="sales")
        self.stranger = User.objects.create_user("str", "str@x.com", "pass@12345", department="warehouse")
        self.client = APIClient()

    def tearDown(self):
        access.forget()

    def only(self, *grants):
        """Gives `me` exactly these grants (one role from the Platform), signed in as them."""
        UserAccessRole.objects.filter(user=self.me).delete()
        role = AccessRole.objects.create(code=f"r{AccessRole.objects.count()}", name=f"R{AccessRole.objects.count()}")
        for g in grants:
            permission, scope = g if isinstance(g, tuple) else (g, "")
            AccessGrant.objects.create(role=role, permission=permission, scope=scope)
        UserAccessRole.objects.create(user=self.me, role=role)
        access.forget()
        self.me = User.objects.get(pk=self.me.pk)
        self.client.force_authenticate(self.me)

    def status(self, method, url, data=None):
        return getattr(self.client, method)(url, data or {}, format="json").status_code

    def assertAllowed(self, code, msg=None):
        self.assertNotIn(code, (401, 403), msg)

    def test_tasks_area(self):
        self.only()
        self.assertEqual(self.status("get", "/api/tasks/team_report/"), 403)
        self.assertEqual(self.status("get", "/api/tasks/?scope=deleted"), 403)
        self.assertEqual(self.status("post", "/api/task-templates/", {"name": "x"}), 403)
        self.assertEqual(self.status("post", "/api/task-settings/", {}), 403)
        self.assertEqual(self.status("post", "/api/groups/", {"name": "G"}), 403)
        self.only("tasks.team_performance", "tasks.bin", "templates.manage", "tasks.settings", "groups.create")
        self.assertAllowed(self.status("get", "/api/tasks/team_report/"))
        self.assertAllowed(self.status("get", "/api/tasks/?scope=deleted"))
        self.assertAllowed(self.status("post", "/api/task-templates/", {"name": "x"}))
        self.assertAllowed(self.status("post", "/api/task-settings/", {}))
        self.assertAllowed(self.status("post", "/api/groups/", {"name": "G"}))

    def test_reports_reach_only_with_the_permission(self):
        from crm.models import Task
        Task.objects.create(title="Colleague's job", assigned_to=self.colleague, created_by=self.boss, effort_minutes=10,
                            due_at=timezone.now())
        self.only(("tasks.view", "department"))
        ids = {r["user"] for r in self.client.get("/api/tasks/employees_report/").data["rows"]}
        self.assertNotIn(self.colleague.pk, ids, "without Reports: only themself and their reports")
        self.assertEqual(self.status("get", "/api/tasks/dashboard/?scope=group"), 403)
        self.only(("tasks.view", "department"), "tasks.reports")
        ids = {r["user"] for r in self.client.get("/api/tasks/employees_report/").data["rows"]}
        self.assertIn(self.colleague.pk, ids)
        self.assertAllowed(self.status("get", "/api/tasks/dashboard/?scope=group"))

    def test_leads(self):
        self.only(("leads.view", "company"))
        self.assertEqual(self.status("get", "/api/assignment-rules/"), 403)
        self.only(("leads.view", "company"), "leads.rules")
        self.assertEqual(self.status("get", "/api/assignment-rules/"), 200)

    def test_notices_links_mistakes(self):
        self.only()
        for url in ("/api/notices/", "/api/links/", "/api/mistakes/", "/api/sops/", "/api/directory/industries/"):
            self.assertEqual(self.status("get", url), 403, url)
        self.only("notices.view", "links.view", "mistakes.view", "directory.view")
        for url in ("/api/notices/", "/api/links/", "/api/mistakes/", "/api/sops/", "/api/directory/industries/"):
            self.assertEqual(self.status("get", url), 200, url)
        self.assertEqual(self.status("post", "/api/notices/", {"title": "Hi", "content": "x"}), 403)
        self.assertEqual(self.status("post", "/api/link-collections/", {"name": "C"}), 403)
        self.assertEqual(self.status("post", "/api/sops/", {"title": "S"}), 403)
        self.only("notices.publish", "links.manage", "sops.manage")
        self.assertAllowed(self.status("post", "/api/notices/", {"title": "Hi", "content": "x"}))
        self.assertEqual(self.status("post", "/api/link-collections/", {"name": "C"}), 201)
        self.assertAllowed(self.status("post", "/api/sops/", {"title": "S"}))

    def test_notifications_list(self):
        self.only()
        self.assertEqual(self.status("get", "/api/notifications/"), 403)
        self.assertEqual(self.status("post", "/api/notifications/read_all/"), 200, "marking read never fails")
        self.only("notifications.view")
        self.assertEqual(self.status("get", "/api/notifications/"), 200)

    def test_my_attendance(self):
        self.only()
        self.assertEqual(self.status("post", "/api/attendance/check_in/"), 403)
        self.assertEqual(self.status("get", "/api/attendance/monthly/"), 403)
        self.assertEqual(self.status("get", "/api/holidays/"), 403)
        self.assertEqual(self.status("post", "/api/leaves/", {}), 403)
        self.only("attendance.punch", "attendance.self", "holidays.view")
        self.assertAllowed(self.status("post", "/api/attendance/check_in/"))
        self.assertEqual(self.status("get", "/api/attendance/monthly/"), 200)
        self.assertEqual(self.status("get", "/api/holidays/"), 200)
        self.assertEqual(self.status("post", "/api/holidays/", {"name": "Diwali", "date": "2026-11-08"}), 403)

    def test_attendance_screens_each_need_their_permission(self):
        yesterday = (timezone.localdate() - timedelta(days=1)).isoformat()
        self.only()
        self.assertEqual(self.status("get", "/api/attendance/team_day/"), 403)
        self.only(("hr.live", "team"))
        names = {r["user_id"] for r in self.client.get("/api/attendance/team_day/").data["rows"]}
        self.assertEqual(names, {self.me.pk, self.report.pk}, "Team: me and my direct reports")
        self.assertEqual(self.status("get", f"/api/attendance/team_day/?date={yesterday}"), 403, "another day is Daily")
        self.assertEqual(self.status("get", "/api/attendance/team_month/"), 403)
        self.assertEqual(self.status("get", "/api/attendance/report/?type=daily&format=csv"), 403)
        self.assertEqual(self.status("get", "/api/hr/settings/"), 403)
        self.only(("hr.daily", "department"), ("hr.dashboard", "company"), ("hr.reports", "team"))
        names = {r["user_id"] for r in self.client.get(f"/api/attendance/team_day/?date={yesterday}").data["rows"]}
        self.assertEqual(names, {self.me.pk, self.report.pk, self.colleague.pk, self.boss.pk}, "Department: + my department")
        self.assertEqual(self.status("get", "/api/attendance/team_month/"), 200)
        self.assertEqual(self.status("get", "/api/attendance/report/?type=daily&format=csv"), 200)

    def test_hr_administration(self):
        self.only()
        self.assertEqual(self.status("post", "/api/attendance/manual_mark/", {"user": self.report.pk}), 403)
        self.assertEqual(self.status("get", "/api/attendance/import_template/?format=csv"), 403)
        self.assertEqual(self.status("get", "/api/payroll-runs/"), 403)
        self.assertEqual(self.status("post", "/api/salary-structures/", {}), 403, "refused before the form is checked")
        self.assertEqual(self.status("post", "/api/leave-types/", {"name": "Comp off"}), 403)
        self.only("hr.mark", "hr.import", "payroll.run", "payroll.salaries", "hr.settings", "holidays.manage")
        self.assertEqual(self.status("post", "/api/attendance/manual_mark/", {"user": self.report.pk}), 200)
        self.assertEqual(self.status("get", "/api/attendance/import_template/?format=csv"), 200)
        self.assertEqual(self.status("get", "/api/payroll-runs/"), 200)
        self.assertEqual(self.status("get", "/api/hr/settings/"), 200)
        self.assertEqual(self.status("post", "/api/leave-types/", {"name": "Comp off"}), 201)
        self.assertEqual(self.status("post", "/api/holidays/", {"name": "Diwali", "date": "2026-11-08"}), 201)

    def test_approving_follows_its_scope(self):
        from hr.approvals import may_review
        self.only(("hr.approve", "team"))
        self.assertTrue(may_review(self.me, self.report))
        self.assertFalse(may_review(self.me, self.colleague), "same department, but Team scope")
        self.only(("hr.approve", "department"))
        self.assertTrue(may_review(self.me, self.colleague))
        self.assertFalse(may_review(self.me, self.stranger))
        self.only(("hr.approve", "company"))
        self.assertTrue(may_review(self.me, self.stranger))
        self.assertFalse(may_review(self.me, self.me), "never their own")
