"""Roles from the database (FreeFounders Phase 3): same answers as the old
hard-coded matrix, and editable, combinable and scoped from now on."""
from django.test import TestCase

from accounts import access
from accounts.models import AccessGrant, AccessRole, Role, User, UserAccessRole
from accounts.permissions import ROLE_CAPABILITIES, capabilities_for, has_capability
from crm.models import Lead, Task
from crm.scoping import ROLE_LEVEL, can_edit_lead, visible_leads, visible_tasks


class AccessTestCase(TestCase):
    def setUp(self):
        access.forget()

    def tearDown(self):
        access.forget()  # role edits roll back with the test; the cache must not outlive them

    def user(self, username, role=Role.SALES_EXECUTIVE, **extra):
        return User.objects.create_user(username, f"{username}@x.com", "pass@12345", role=role, **extra)

    def custom_role(self, code, grants, level=1):
        role = AccessRole.objects.create(code=code, name=code.title(), level=level)
        for permission, scope in grants:
            AccessGrant.objects.create(role=role, permission=permission, scope=scope)
        return role


class SeededRolesTests(AccessTestCase):
    def test_every_built_in_role_is_seeded_with_exactly_its_old_capabilities(self):
        self.assertEqual(AccessRole.objects.filter(code__in=Role.values).count(), len(Role.values))
        for value, _label in Role.choices:
            with self.subTest(value):
                u = User(username=f"x-{value}", role=value)
                self.assertEqual(set(capabilities_for(u)), set(ROLE_CAPABILITIES[value]))
                self.assertEqual(access.level(u), ROLE_LEVEL.get(value, 1))

    def test_the_catalogue_round_trips_every_old_capability(self):
        for value, caps in ROLE_CAPABILITIES.items():
            self.assertEqual(access.capabilities_from_grants(access.grants_from_capabilities(caps)), set(caps), value)


class EditableRolesTests(AccessTestCase):
    def test_the_database_decides_not_the_dict(self):
        u = self.user("wh", Role.WAREHOUSE)
        self.assertFalse(has_capability(u, "tasks.assign"))
        AccessGrant.objects.create(role=AccessRole.objects.get(code=Role.WAREHOUSE), permission="tasks.assign")
        u = User.objects.get(pk=u.pk)
        self.assertTrue(has_capability(u, "tasks.assign"))

    def test_roles_from_the_platform_replace_the_primary_role_and_add_up(self):
        u = self.user("multi", Role.SALES_EXECUTIVE)
        viewer = self.custom_role("viewer", [("tasks.view", "department")])
        approver = self.custom_role("approver", [("hr.approve", ""), ("tasks.view", "own")], level=2)
        UserAccessRole.objects.create(user=u, role=viewer)
        UserAccessRole.objects.create(user=u, role=approver)
        u = User.objects.get(pk=u.pk)
        caps = set(capabilities_for(u))
        self.assertIn("tasks.view_department", caps)          # widest scope from one role
        self.assertIn("hr.approve", caps)                     # plus the other role's permission
        self.assertNotIn("leads.view_own", caps)              # the primary role no longer counts
        self.assertEqual(access.level(u), 2)

    def test_archived_roles_give_nothing(self):
        u = self.user("arch")
        role = self.custom_role("old", [("users.manage", "")])
        UserAccessRole.objects.create(user=u, role=role)
        role.archived = True
        role.save()
        self.assertFalse(has_capability(User.objects.get(pk=u.pk), "users.manage"))

    def test_grants_are_checked_against_the_catalogue(self):
        self.assertTrue(access.valid_grant("tasks.view", "team"))
        self.assertFalse(access.valid_grant("tasks.view", ""))
        self.assertFalse(access.valid_grant("users.manage", "company"))
        self.assertFalse(access.valid_grant("payroll.steal", ""))


class ScopeTests(AccessTestCase):
    def setUp(self):
        super().setUp()
        self.boss = self.user("boss", Role.SALES_EXECUTIVE)
        self.report = self.user("rep", Role.SALES_EXECUTIVE, reporting_manager=self.boss)
        self.stranger = self.user("str", Role.SALES_EXECUTIVE)
        self.reports_task = Task.objects.create(title="Report's job", assigned_to=self.report, created_by=self.stranger, effort_minutes=10)
        self.own_task = Task.objects.create(title="Boss's job", assigned_to=self.boss, created_by=self.stranger, effort_minutes=10)

    def give(self, user, grants):
        role = self.custom_role(f"r-{user.username}-{AccessRole.objects.count()}", grants)
        UserAccessRole.objects.create(user=user, role=role)
        return User.objects.get(pk=user.pk)

    def test_task_team_scope_includes_reports_and_own_scope_does_not(self):
        team = self.give(self.boss, [("tasks.view", "team")])
        self.assertEqual(set(visible_tasks(team)), {self.reports_task, self.own_task})
        UserAccessRole.objects.filter(user=self.boss).delete()
        own = self.give(self.boss, [("tasks.view", "own")])
        self.assertEqual(set(visible_tasks(own)), {self.own_task})

    def test_built_in_roles_still_see_their_reports_tasks(self):
        self.assertIn(self.reports_task, set(visible_tasks(self.boss)))

    def test_lead_team_scope(self):
        mine = Lead.objects.create(customer_name="Mine", assigned_to=self.boss)
        reports = Lead.objects.create(customer_name="Reports", assigned_to=self.report)
        other = Lead.objects.create(customer_name="Other", assigned_to=self.stranger)
        boss = self.give(self.boss, [("leads.view", "team"), ("leads.edit", "team")])
        self.assertEqual(set(visible_leads(boss)), {mine, reports})
        self.assertTrue(can_edit_lead(boss, reports))
        self.assertFalse(can_edit_lead(boss, other))
