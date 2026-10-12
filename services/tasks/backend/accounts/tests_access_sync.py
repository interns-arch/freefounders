"""Roles from the FreeFounders role builder reach Tasks: the internal
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
        self.assertIn("leads.view_own", access.capabilities(User.objects.get(pk=self.u.pk)))  # back to User.role

    def test_a_built_in_role_is_updated_in_place_by_code(self):
        res = self.push(roles=[{"id": str(self.role_id), "code": "warehouse", "name": "Warehouse Team", "level": 1,
                                "grants": [{"permission": "tasks.view", "scope": "own"}, {"permission": "notifications.view"}]}],
                        people=[{"personId": str(self.person), "roleIds": [str(self.role_id)]}])
        self.assertEqual(res.status_code, 200, res.data)
        role = AccessRole.objects.get(code="warehouse")
        self.assertEqual(role.platform_role_id, self.role_id)
        u = User.objects.get(pk=self.u.pk)
        self.assertEqual(u.role, "warehouse")                     # primary role follows
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
