"""Roles from the Kaampilot role builder reach Tasks: the internal
endpoints, and every "who is an admin / who may approve" question honours them."""
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts import access
from accounts.models import AccessRole, Role, User, UserAccessRole
from accounts.tests_platform import JWKS, token
from hr.views import other_approvers


def service():
    return token("platform", {}, aud="tasks-internal")


@override_settings(PLATFORM_JWKS=JWKS)
class AccessSyncTests(TestCase):
    def setUp(self):
        access.forget()
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {service()}")
        self.person = uuid.uuid4()
        self.u = User.objects.create_user("sync", "sync@x.com", "pass@12345", role=Role.SALES_EXECUTIVE,
                                          platform_person_id=self.person)
        self.role_id = uuid.uuid4()

    def tearDown(self):
        access.forget()

    def push(self, version=1, roles=None, people=None, **extra):
        roles = roles if roles is not None else [{
            "id": str(self.role_id), "name": "Floor Lead", "level": 2,
            "grants": [{"app": "tasks", "permission": "tasks.view", "scope": "department"},
                       {"app": "tasks", "permission": "hr.approve", "scope": ""},
                       {"app": "assets", "permission": "asset:view", "scope": "company"},
                       {"app": "tasks", "permission": "payroll.steal", "scope": ""}],
        }]
        people = people if people is not None else [{"personId": str(self.person), "roleIds": [str(self.role_id)]}]
        extra.setdefault("catalogueVersions", {"tasks": access.CATALOGUE_VERSION})   # an up-to-date Platform
        return self.api.put("/api/internal/access", {"version": version, "roles": roles, "people": people, **extra}, format="json")

    def test_needs_the_platform(self):
        self.assertEqual(APIClient().get("/api/internal/permissions").status_code, 401)
        self.assertEqual(APIClient().put("/api/internal/access", {}, format="json").status_code, 401)

    def test_publishes_the_permission_catalogue(self):
        res = self.api.get("/api/internal/permissions")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["scopes"], ["own", "team", "department", "company"])
        view = next(p for p in res.data["permissions"] if p["key"] == "tasks.view")
        self.assertEqual(view["scopes"], ["own", "team", "department", "company"])

    def test_a_pushed_role_gives_exactly_its_tasks_permissions(self):
        res = self.push()
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["roles"], 1)
        self.assertEqual(len(res.data["problems"]), 1)          # payroll.steal refused, assets grant ignored
        u = User.objects.get(pk=self.u.pk)
        self.assertEqual(set(access.capabilities(u)), {"tasks.view_department", "hr.approve"})
        self.assertEqual(access.level(u), 2)
        self.assertIn(u, other_approvers(User.objects.create_user("x", "x@x.com", "pass@12345")))

    def test_pushes_replace_roles_and_old_versions_are_ignored(self):
        self.push(version=2)
        stale = self.push(version=1, people=[{"personId": str(self.person), "roleIds": []}])
        self.assertFalse(stale.data["applied"])
        self.assertEqual(UserAccessRole.objects.filter(user=self.u).count(), 1)
        # The role is deleted in the Platform: archived here, so it gives nothing.
        self.push(version=3, roles=[], people=[{"personId": str(self.person), "roleIds": []}])
        self.assertTrue(AccessRole.objects.get(platform_role_id=self.role_id).archived)
        self.assertEqual(UserAccessRole.objects.filter(user=self.u).count(), 0)
        # Under the Platform nothing comes from a role name (PLAN.md §19.28): no role, no access.
        u = User.objects.get(pk=self.u.pk)
        self.assertEqual(u.role, Role.MEMBER)
        self.assertEqual(access.capabilities(u), set())

    def test_a_built_in_role_is_updated_in_place_by_code(self):
        res = self.push(roles=[{"id": str(self.role_id), "code": "warehouse", "name": "Warehouse Team", "level": 1,
                                "grants": [{"permission": "tasks.view", "scope": "own"}, {"permission": "notifications.view"}]}],
                        people=[{"personId": str(self.person), "roleIds": [str(self.role_id)]}])
        self.assertEqual(res.status_code, 200, res.data)
        role = AccessRole.objects.get(code="warehouse")
        self.assertEqual(role.platform_role_id, self.role_id)
        u = User.objects.get(pk=self.u.pk)
        self.assertEqual(u.role, Role.MEMBER)                     # the role field stays neutral (PLAN.md §19.28)
        self.assertEqual(set(access.capabilities(u)), {"tasks.view_self", "notifications.view"})

    def test_admin_level_roles_are_admins_everywhere(self):
        self.push(roles=[{"id": str(self.role_id), "name": "Owner's deputy", "level": 3,
                          "grants": [{"permission": "tasks.view", "scope": "company"}]}])
        u = User.objects.get(pk=self.u.pk)
        self.assertTrue(access.is_admin(u))
        self.assertTrue(u.is_admin_role)
        self.assertIn(u, access.users_at_level(3))
        self.assertIn(u, access.users_with("tasks.view_all"))
        self.assertFalse(access.is_super_admin(u))

    def test_export_lists_roles_and_people(self):
        self.push()
        res = self.api.get("/api/internal/access")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["version"], 1)
        self.assertTrue(any(r["code"] == "super_admin" for r in res.data["roles"]))
        mine = next(p for p in res.data["people"] if p["personId"] == str(self.person))
        self.assertEqual(len(mine["roles"]), 1)


@override_settings(PLATFORM_JWKS=JWKS)
class TwoBuiltInRolesTests(TestCase):
    """PLAN.md §19.28: under the Platform only its roles count (Admin, Member, roles made in the role builder), plus the
    hidden Owner role and a person's personal role (extra access + own duties)."""

    def setUp(self):
        access.forget()
        self.api = APIClient()
        self.api.credentials(HTTP_AUTHORIZATION=f"Bearer {service()}")
        self.pid, self.owner_pid = uuid.uuid4(), uuid.uuid4()
        self.u = User.objects.create_user("mem", "mem@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, platform_person_id=self.pid)
        self.boss = User.objects.create_user("boss", "boss@x.com", "pass@12345", role=Role.SALES_EXECUTIVE, platform_person_id=self.owner_pid)
        self.ids = {k: str(uuid.uuid4()) for k in ("admin", "member", "owner", "personal")}
        self.version = 0

    def tearDown(self):
        access.forget()

    def push(self, personal_grants=None, duties=None):
        self.version += 1
        roles = [
            {"id": self.ids["admin"], "code": "ff_admin", "name": "Admin", "level": 3, "system": True, "kind": "role",
             "grants": [{"permission": "tasks.view", "scope": "company"}, {"permission": "tasks.assign"}]},
            {"id": self.ids["member"], "code": "ff_member", "name": "Member", "level": 1, "system": True, "kind": "role",
             "grants": [{"permission": "tasks.view", "scope": "own"}, {"permission": "attendance.punch"}]},
            {"id": self.ids["owner"], "code": "ff_owner", "name": "Owner (all access)", "level": 3, "system": True, "kind": "owner",
             "grants": [{"permission": "tasks.view", "scope": "company"}, {"permission": "tasks.delete_admin_work"}]},
        ]
        mine = [self.ids["member"]]
        if personal_grants is not None or duties:
            roles.append({"id": self.ids["personal"], "code": f"ff_person_{self.pid.hex}", "name": "Personal · Mem", "level": 1,
                          "kind": "personal", "grants": [{"permission": p} for p in (personal_grants or [])], "duties": duties or []})
            mine.append(self.ids["personal"])
        res = self.api.put("/api/internal/access", {
            "version": self.version, "roles": roles, "catalogueVersions": {"tasks": access.CATALOGUE_VERSION},
            "people": [{"personId": str(self.pid), "roleIds": mine},
                       {"personId": str(self.owner_pid), "roleIds": [self.ids["admin"], self.ids["owner"]]}],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        access.forget()
        return res

    def test_the_apps_own_built_in_roles_are_archived_and_role_names_mean_nothing(self):
        self.push()
        self.assertFalse(AccessRole.objects.filter(platform_role_id__isnull=True, archived=False).exists(),
                         "the 20 standalone roles are not used under the Platform")
        self.assertEqual(User.objects.get(pk=self.u.pk).role, Role.MEMBER)
        # A user left with the old role name and no Platform role gets nothing from it.
        legacy = User.objects.create_user("legacy", "l@x.com", "pass@12345", role=Role.SUPER_ADMIN)
        self.assertEqual(access.capabilities(legacy), set())
        # The role dropdown lists the Platform's roles, without the hidden ones.
        c = APIClient()
        c.force_authenticate(self.u)
        served = [r["value"] for r in c.get("/api/roles/").data]
        self.assertEqual(served, ["ff_admin", "ff_member"])

    def test_member_gets_exactly_member_and_extra_access_adds_to_it(self):
        self.push()
        u = User.objects.get(pk=self.u.pk)
        self.assertEqual(access.capabilities(u), {"tasks.view_self", "attendance.punch"})
        self.assertFalse(access.is_admin(u))
        self.push(personal_grants=["tasks.assign"])
        u = User.objects.get(pk=self.u.pk)
        self.assertIn("tasks.assign", access.capabilities(u), "personal extra access counts like any role")
        c = APIClient()
        c.force_authenticate(u)
        me = c.get("/api/auth/me").data
        self.assertEqual(me["role"], "ff_member")
        self.assertEqual(me["role_display"], "Member", "the personal role is never shown as a role")
        self.push(personal_grants=[])
        self.assertNotIn("tasks.assign", access.capabilities(User.objects.get(pk=self.u.pk)))

    def test_the_owner_has_everything_through_the_hidden_owner_role(self):
        self.push()
        boss = User.objects.get(pk=self.boss.pk)
        self.assertTrue(access.is_owner(boss), "the Owner role holds tasks.delete_admin_work")
        self.assertTrue(access.is_admin(boss))
        self.assertEqual([r.code for r in access.listed_roles(boss)], ["ff_admin"], "Owner is a mark, not a listed role")
        self.assertFalse(access.is_owner(User.objects.get(pk=self.u.pk)))

    def test_a_personal_duty_becomes_a_task_for_that_person_only(self):
        from datetime import date
        from unittest import mock

        from crm.duties import create_duty_tasks
        from crm.models import Task
        duty = {"id": str(uuid.uuid4()), "title": "Water the plants", "frequency": "daily", "steps": ["Front", "Back"]}
        with mock.patch("notifications.service.gmail.send_email", return_value={"channel": "email", "status": "skipped"}):
            self.push(duties=[duty])
            create_duty_tasks(today=date(2026, 11, 2))  # a Monday
        mine = Task.objects.filter(title="Water the plants")
        self.assertEqual([t.assigned_to_id for t in mine], [self.u.pk])
