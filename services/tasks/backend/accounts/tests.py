from django.test import TestCase
from rest_framework.test import APIClient

from .models import DepartmentOption, Role, User


def make(username, role, password="pass@12345"):
    return User.objects.create_user(username, f"{username}@x.com", password, role=role)


class AuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make("boss", Role.ADMIN)
        self.exec_ = make("neha", Role.SALES_EXECUTIVE)

    def login(self, username, password="pass@12345"):
        res = self.client.post("/api/auth/login", {"username": username, "password": password})
        return res

    def auth(self, username):
        res = self.login(username)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return res.data

    def test_login_ok_and_me(self):
        self.auth("boss")
        res = self.client.get("/api/auth/me")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["role"], "admin")
        self.assertIn("users.manage", res.data["capabilities"])

    def test_login_wrong_password(self):
        res = self.login("boss", "wrong")
        self.assertEqual(res.status_code, 401)

    def test_login_with_email_works(self):
        res = self.client.post("/api/auth/login",
                               {"username": "boss@x.com", "password": "pass@12345"})
        self.assertEqual(res.status_code, 200)
        # case-insensitive too
        res = self.client.post("/api/auth/login",
                               {"username": "BOSS@X.COM", "password": "pass@12345"})
        self.assertEqual(res.status_code, 200)

    def test_login_with_unknown_email_fails(self):
        res = self.client.post("/api/auth/login",
                               {"username": "nobody@x.com", "password": "pass@12345"})
        self.assertEqual(res.status_code, 401)

    def test_inactive_user_cannot_login(self):
        self.exec_.is_active = False
        self.exec_.save()
        self.assertEqual(self.login("neha").status_code, 401)

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)

    def test_refresh_and_logout_blacklist(self):
        tokens = self.auth("boss")
        res = self.client.post("/api/auth/refresh", {"refresh": tokens["refresh"]})
        self.assertEqual(res.status_code, 200)
        # rotated: logout with the NEW refresh, then it must be unusable
        new_refresh = res.data["refresh"]
        self.assertEqual(self.client.post("/api/auth/logout", {"refresh": new_refresh}).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/refresh", {"refresh": new_refresh}).status_code, 401)


class UserManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make("boss", Role.ADMIN)
        self.exec_ = make("neha", Role.SALES_EXECUTIVE)
        self.exec_.whatsapp_phone = "9876500000"
        self.exec_.reporting_manager = self.admin
        self.exec_.save(update_fields=["whatsapp_phone", "reporting_manager"])

    def as_(self, username):
        res = self.client.post("/api/auth/login", {"username": username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_non_admin_cannot_list_users(self):
        self.as_("neha")
        self.assertEqual(self.client.get("/api/users/").status_code, 403)

    def test_admin_creates_user_with_role(self):
        self.as_("boss")
        res = self.client.post("/api/users/", {
            "username": "sonal", "email": "sonal@x.com", "password": "sonal@12345",
            "role": "sales_manager", "department": "sales", "first_name": "Sonal",
            "whatsapp_phone": "9876543210", "reporting_manager": self.admin.id,
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["role"], "sales_manager")
        self.assertIn("leads.assign", User.objects.get(username="sonal").role and res.data["capabilities"])

    def test_create_requires_contact_and_manager(self):
        """A blank email/phone silently drops that person's notifications and
        a blank "Reports to" sends their approvals to the admins, so all three
        are mandatory."""
        self.as_("boss")
        res = self.client.post("/api/users/", {
            "username": "gaps", "password": "sonal@12345",
            "role": "warehouse", "department": "warehouse",
        })
        self.assertEqual(res.status_code, 400)
        for field in ("email", "whatsapp_phone", "reporting_manager"):
            self.assertIn(field, res.data)

    def test_admin_needs_no_reporting_manager(self):
        self.as_("boss")
        res = self.client.post("/api/users/", {
            "username": "boss2", "email": "boss2@x.com", "password": "sonal@12345",
            "role": "admin", "department": "management",
            "whatsapp_phone": "9876543211",
        })
        self.assertEqual(res.status_code, 201)

    def test_phone_must_look_like_a_number(self):
        self.as_("boss")
        res = self.client.post("/api/users/", {
            "username": "badphone", "email": "b@x.com", "password": "sonal@12345",
            "role": "warehouse", "department": "warehouse",
            "whatsapp_phone": "12345", "reporting_manager": self.admin.id,
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("whatsapp_phone", res.data)

    def test_nobody_reports_to_themselves(self):
        self.as_("boss")
        res = self.client.patch(f"/api/users/{self.exec_.id}/",
                                {"reporting_manager": self.exec_.id})
        self.assertEqual(res.status_code, 400)
        self.assertIn("reporting_manager", res.data)

    def test_create_requires_password(self):
        self.as_("boss")
        res = self.client.post("/api/users/", {"username": "nopass", "role": "accounts"})
        self.assertEqual(res.status_code, 400)

    def test_weak_password_rejected(self):
        self.as_("boss")
        res = self.client.post("/api/users/", {"username": "weak", "password": "short", "role": "it_lead"})
        self.assertEqual(res.status_code, 400)

    def test_deactivate_and_activate(self):
        self.as_("boss")
        res = self.client.post(f"/api/users/{self.exec_.id}/deactivate/")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(User.objects.get(pk=self.exec_.pk).is_active)
        res = self.client.post(f"/api/users/{self.exec_.id}/activate/")
        self.assertTrue(User.objects.get(pk=self.exec_.pk).is_active)

    def test_cannot_deactivate_self(self):
        self.as_("boss")
        self.assertEqual(self.client.post(f"/api/users/{self.admin.id}/deactivate/").status_code, 400)

    def test_delete_is_blocked(self):
        self.as_("boss")
        self.assertEqual(self.client.delete(f"/api/users/{self.exec_.id}/").status_code, 405)

    def test_admin_updates_role_without_password(self):
        self.as_("boss")
        res = self.client.patch(f"/api/users/{self.exec_.id}/", {"role": "it_lead"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["role"], "it_lead")
        # password unchanged -- login still works
        c2 = APIClient()
        self.assertEqual(c2.post("/api/auth/login", {"username": "neha", "password": "pass@12345"}).status_code, 200)


class DepartmentListTests(TestCase):
    """The department dropdown is data, not code: Admin can add/rename/remove
    it from Settings and every form picks the change up."""

    def setUp(self):
        self.client = APIClient()
        self.admin = make("boss", Role.ADMIN)
        self.emp = make("neha", Role.SALES_EXECUTIVE)

    def as_(self, username):
        res = self.client.post("/api/auth/login",
                               {"username": username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_everyone_reads_the_seeded_list(self):
        self.as_("neha")
        res = self.client.get("/api/departments/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("sales", [d["code"] for d in res.data])

    def test_only_admin_adds(self):
        self.as_("neha")
        self.assertEqual(self.client.post("/api/departments/",
                                          {"name": "Logistics"}).status_code, 403)
        self.as_("boss")
        res = self.client.post("/api/departments/", {"name": "Logistics"})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["code"], "logistics")

    def test_a_user_can_be_put_in_a_brand_new_department(self):
        self.as_("boss")
        self.client.post("/api/departments/", {"name": "Logistics"})
        res = self.client.post("/api/users/", {
            "username": "logi", "email": "logi@x.com", "password": "sonal@12345",
            "role": "warehouse", "department": "logistics",
            "whatsapp_phone": "9876543210", "reporting_manager": self.admin.id,
        })
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(User.objects.get(username="logi").department, "logistics")

    def test_unknown_department_is_rejected(self):
        self.as_("boss")
        res = self.client.post("/api/users/", {
            "username": "ghost", "email": "g@x.com", "password": "sonal@12345",
            "role": "warehouse", "department": "does-not-exist",
            "whatsapp_phone": "9876543210", "reporting_manager": self.admin.id,
        })
        self.assertEqual(res.status_code, 400)
        self.assertIn("department", res.data)

    def test_rename_keeps_the_code(self):
        self.as_("boss")
        res = self.client.patch("/api/departments/support/", {"name": "IT & Systems"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["code"], "support")
        self.assertEqual(DepartmentOption.objects.get(code="support").name, "IT & Systems")

    def test_department_in_use_cannot_be_removed(self):
        self.as_("boss")
        res = self.client.delete("/api/departments/sales/")   # neha is in sales
        self.assertEqual(res.status_code, 400)
        self.assertTrue(DepartmentOption.objects.get(code="sales").active)

    def test_empty_department_is_removed_from_the_list(self):
        self.as_("boss")
        self.client.post("/api/departments/", {"name": "Logistics"})
        self.assertEqual(self.client.delete("/api/departments/logistics/").status_code, 200)
        codes = [d["code"] for d in self.client.get("/api/departments/").data]
        self.assertNotIn("logistics", codes)


class RoleWiringTests(TestCase):
    """A role lives in three places: the choices, the capability matrix and
    the assignment level. Miss one and the person is either uncreatable or
    silently gets the wrong access — so walk every role and check all three."""

    def test_every_role_has_capabilities(self):
        from .permissions import ROLE_CAPABILITIES
        missing = [r.value for r in Role if r not in ROLE_CAPABILITIES]
        self.assertEqual(missing, [],
                         f"roles with no entry in ROLE_CAPABILITIES: {missing}")

    def test_every_role_has_a_sane_assignment_level(self):
        from crm.scoping import ROLE_LEVEL, assignment_level
        for r in Role:
            lvl = ROLE_LEVEL.get(r, 1)
            self.assertIn(lvl, (1, 2, 3), f"{r.value} has level {lvl}")
        # a manager-sounding role must not silently sit at staff level
        for r in Role:
            if r.value.endswith("_manager") or r.value in ("admin", "it_lead"):
                self.assertGreaterEqual(
                    ROLE_LEVEL.get(r, 1), 2,
                    f"{r.value} looks senior but can only assign at staff level")

    def test_every_role_has_a_default_department(self):
        from .models import ROLE_DEFAULT_DEPARTMENT
        missing = [r.value for r in Role if r not in ROLE_DEFAULT_DEPARTMENT]
        self.assertEqual(missing, [],
                         f"roles with no default department: {missing}")

    def test_the_new_staff_roles_see_only_their_own_work(self):
        from .permissions import ROLE_CAPABILITIES
        for role in (Role.HOUSEKEEPING, Role.SECURITY, Role.LEGAL, Role.HR_EXECUTIVE):
            caps = ROLE_CAPABILITIES[role]
            self.assertEqual(caps, {"tasks.view_own", "notifications.view"},
                             f"{role.value} has more access than intended: {caps}")

    def test_a_user_can_actually_be_created_with_each_new_role(self):
        self.client = APIClient()
        res = self.client.post("/api/auth/login",
                               {"username": "boss", "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        for i, role in enumerate((Role.HOUSEKEEPING, Role.SECURITY,
                                  Role.LEGAL, Role.HR_EXECUTIVE)):
            r = self.client.post("/api/users/", {
                "username": f"new{i}", "email": f"new{i}@x.com",
                "password": "sonal@12345", "role": role.value,
                "department": "warehouse", "whatsapp_phone": f"98765432{i}0",
                "reporting_manager": self.admin.id})
            self.assertEqual(r.status_code, 201, f"{role.value}: {r.data}")

    def setUp(self):
        self.admin = make("boss", Role.ADMIN)


class RolesEndpointTests(TestCase):
    """The role dropdown used to be typed out again in the frontend, so the
    four roles added on 03 Sep existed in the backend but were missing from
    every form. The list now comes from here -- these tests are what stops it
    drifting again."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "rolecheck", "rolecheck@x.com", "pass@12345",
            role=Role.SALES_EXECUTIVE, department="sales")
        res = self.client.post("/api/auth/login",
                               {"username": "rolecheck", "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_every_role_the_backend_accepts_is_offered(self):
        served = {r["value"] for r in self.client.get("/api/roles/").data}
        self.assertEqual(served, {value for value, _ in Role.choices})

    def test_the_roles_added_on_03_sep_are_there(self):
        served = {r["value"] for r in self.client.get("/api/roles/").data}
        for role in ("housekeeping", "security", "legal", "hr_executive"):
            self.assertIn(role, served)

    def test_manager_flag_matches_the_assignment_level(self):
        from crm.scoping import ROLE_LEVEL
        for row in self.client.get("/api/roles/").data:
            self.assertEqual(row["is_manager"], ROLE_LEVEL.get(row["value"], 1) >= 2,
                             f"{row['value']} disagrees with ROLE_LEVEL")

    def test_labels_are_human_readable(self):
        rows = self.client.get("/api/roles/").data
        by_value = {r["value"]: r["label"] for r in rows}
        self.assertEqual(by_value["security"], "Security")
        self.assertEqual(by_value["hr_executive"], "HR Executive")

    def test_signed_out_callers_get_nothing(self):
        self.client.credentials()
        self.assertEqual(self.client.get("/api/roles/").status_code, 401)


class ContactRequiredTests(TestCase):
    """Email was flatly required until 03 Sep 2026, when mail to a mailbox IT
    had not created yet bounced back to the sending account for weeks. A blank
    address now simply means "no mail" -- the same way a blank phone means no
    WhatsApp. Blanking BOTH is still refused: that person would never be told
    anything at all."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            "contact.boss", "boss@x.com", "pass@12345",
            role=Role.ADMIN, department="management")
        self.mgr = User.objects.create_user(
            "contact.mgr", "mgr@x.com", "pass@12345",
            role=Role.SALES_MANAGER, department="sales")
        res = self.client.post("/api/auth/login",
                               {"username": "contact.boss", "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def body(self, **over):
        return {"username": "newjoiner", "email": "new@x.com", "password": "pass@12345",
                "role": Role.SALES_EXECUTIVE, "department": "sales",
                "whatsapp_phone": "9711539878",
                "reporting_manager": self.mgr.id, **over}

    def test_a_joiner_with_no_mailbox_yet_can_be_created(self):
        res = self.client.post("/api/users/", self.body(email=""), format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(User.objects.get(username="newjoiner").email, "")

    def test_a_person_with_no_phone_still_needs_an_email(self):
        res = self.client.post("/api/users/", self.body(whatsapp_phone=""), format="json")
        self.assertEqual(res.status_code, 201, res.data)

    def test_blanking_both_is_refused(self):
        res = self.client.post("/api/users/",
                               self.body(email="", whatsapp_phone=""), format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("email", res.data)

    def test_an_existing_address_can_be_cleared_when_it_bounces(self):
        """The actual fix for Jagdish: an admin can turn mail off themselves."""
        u = User.objects.create_user("bouncer", "dead@cartrends.in", "pass@12345",
                                     role=Role.SALES_EXECUTIVE, department="sales",
                                     whatsapp_phone="9711539878",
                                     reporting_manager=self.mgr)
        res = self.client.patch(f"/api/users/{u.id}/", {"email": ""}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        u.refresh_from_db()
        self.assertEqual(u.email, "")

    def test_clearing_the_last_channel_is_still_refused(self):
        u = User.objects.create_user("lastone", "x@y.com", "pass@12345",
                                     role=Role.SALES_EXECUTIVE, department="sales",
                                     whatsapp_phone="", reporting_manager=self.mgr)
        res = self.client.patch(f"/api/users/{u.id}/", {"email": ""}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_a_bad_phone_is_still_rejected(self):
        res = self.client.post("/api/users/", self.body(whatsapp_phone="12345"), format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("whatsapp_phone", res.data)

    def test_no_mail_is_sent_to_a_blank_address(self):
        from notifications.channels.gmail import send_email
        out = send_email("", "subject", "body")
        self.assertEqual(out["status"], "skipped")
        self.assertIn("no email", out["detail"])


class ITTeamRoleTests(TestCase):
    """IT Team sits under IT Lead, the same shape as Warehouse Team under
    Warehouse Manager: the lead assigns and sees the department, the team
    works their own tasks."""

    def setUp(self):
        self.client = APIClient()
        self.lead = User.objects.create_user("it.lead", "l@x.com", "pass@12345",
                                             role=Role.IT_LEAD, department="support")
        self.member = User.objects.create_user("it.member", "m@x.com", "pass@12345",
                                               role=Role.IT_TEAM, department="support",
                                               reporting_manager=self.lead)

    def as_(self, user):
        res = self.client.post("/api/auth/login",
                               {"username": user.username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_it_appears_in_the_role_dropdown(self):
        """The list is served from the backend, so a new role shows up in
        every form without a frontend change."""
        self.as_(self.lead)
        served = {r["value"]: r for r in self.client.get("/api/roles/").data}
        self.assertIn("it_team", served)
        self.assertEqual(served["it_team"]["label"], "IT Team")

    def test_it_is_staff_level_not_a_manager(self):
        served = None
        self.as_(self.lead)
        served = {r["value"]: r for r in self.client.get("/api/roles/").data}
        self.assertFalse(served["it_team"]["is_manager"])
        self.assertTrue(served["it_lead"]["is_manager"])

    def test_the_lead_can_assign_to_the_team(self):
        from crm.scoping import can_assign_to
        self.assertTrue(can_assign_to(self.lead, self.member))

    def test_the_team_can_assign_upward_to_the_lead(self):
        from crm.scoping import can_assign_to
        self.assertTrue(can_assign_to(self.member, self.lead))

    def test_they_see_only_their_own_work(self):
        from .permissions import capabilities_for
        caps = set(capabilities_for(self.member))
        self.assertIn("tasks.view_own", caps)
        self.assertNotIn("tasks.view_all", caps)
        self.assertNotIn("tasks.view_department", caps)
        self.assertNotIn("tasks.assign", caps)

    def test_they_land_in_the_support_department_by_default(self):
        from .models import ROLE_DEFAULT_DEPARTMENT
        self.assertEqual(ROLE_DEFAULT_DEPARTMENT[Role.IT_TEAM],
                         ROLE_DEFAULT_DEPARTMENT[Role.IT_LEAD])

    def test_one_can_actually_be_created_through_the_api(self):
        admin = User.objects.create_user("it.boss", "b@x.com", "pass@12345",
                                         role=Role.ADMIN, department="management")
        self.as_(admin)
        res = self.client.post("/api/users/", {
            "username": "newit", "email": "newit@x.com", "password": "pass@12345",
            "role": Role.IT_TEAM, "department": "support",
            "whatsapp_phone": "9876543210", "reporting_manager": self.lead.id,
        }, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(User.objects.get(username="newit").role, Role.IT_TEAM)


class SuperAdminRoleGuardTests(TestCase):
    """14 Sep 2026: a Super Admin trying to change roles got "You cannot change
    your own role" -- the guard only waved Role.ADMIN through. And the reverse
    hole: any admin could hand out Super Admin."""

    def setUp(self):
        self.client = APIClient()
        mk = lambda u, r, d="management": User.objects.create_user(
            u, f"{u}@x.com", "pass@12345", role=r, department=d,
            whatsapp_phone="9876543210")
        self.sup = mk("g.sup", Role.SUPER_ADMIN)
        self.adm = mk("g.adm", Role.ADMIN)
        self.emp = mk("g.emp", Role.SALES_EXECUTIVE, "sales")
        self.emp.reporting_manager = self.adm
        self.emp.save()

    def as_(self, u):
        res = self.client.post("/api/auth/login", {"username": u.username, "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def patch(self, target, role):
        return self.client.patch(f"/api/users/{target.id}/", {"role": role}, format="json")

    # ---- super admin -------------------------------------------------------
    def test_super_admin_changes_anyones_role(self):
        self.as_(self.sup)
        self.assertEqual(self.patch(self.emp, Role.SALES_MANAGER).status_code, 200)

    def test_super_admin_edits_an_admin(self):
        self.as_(self.sup)
        res = self.client.patch(f"/api/users/{self.adm.id}/",
                                {"role": Role.SALES_MANAGER,
                                 "reporting_manager": self.sup.id}, format="json")
        self.assertEqual(res.status_code, 200, res.data)

    def test_super_admin_can_make_another_super_admin(self):
        self.as_(self.sup)
        self.assertEqual(self.patch(self.adm, Role.SUPER_ADMIN).status_code, 200)

    def test_super_admin_can_change_their_own_role_if_another_remains(self):
        other = User.objects.create_user("g.sup2", "s2@x.com", "pass@12345",
                                         role=Role.SUPER_ADMIN, department="management")
        self.as_(self.sup)
        self.assertEqual(self.patch(self.sup, Role.ADMIN).status_code, 200)

    def test_the_last_super_admin_cannot_demote_themself(self):
        """Nobody could hand out roles again."""
        self.as_(self.sup)
        res = self.patch(self.sup, Role.ADMIN)
        self.assertEqual(res.status_code, 403)
        self.assertIn("only Super Admin", str(res.data))

    # ---- admin -------------------------------------------------------------
    def test_an_admin_cannot_grant_super_admin(self):
        self.as_(self.adm)
        res = self.patch(self.emp, Role.SUPER_ADMIN)
        self.assertEqual(res.status_code, 403)
        self.emp.refresh_from_db()
        self.assertNotEqual(self.emp.role, Role.SUPER_ADMIN)

    def test_an_admin_cannot_make_themself_super_admin(self):
        self.as_(self.adm)
        self.assertEqual(self.patch(self.adm, Role.SUPER_ADMIN).status_code, 403)

    def test_an_admin_cannot_edit_a_super_admin(self):
        self.as_(self.adm)
        self.assertEqual(self.patch(self.sup, Role.ADMIN).status_code, 403)

    def test_an_admin_still_changes_ordinary_roles(self):
        self.as_(self.adm)
        self.assertEqual(self.patch(self.emp, Role.SALES_MANAGER).status_code, 200)


class TopAdminEverywhereTests(TestCase):
    """Seven places compared the role to "admin" directly and shut a Super
    Admin out. Every "is this an admin?" now asks is_top_admin(), and these
    pin the ones that bit."""

    def setUp(self):
        self.client = APIClient()
        self.sup = User.objects.create_user("t.sup", "t@x.com", "pass@12345",
                                            role=Role.SUPER_ADMIN, department="management",
                                            whatsapp_phone="9876543210")
        res = self.client.post("/api/auth/login", {"username": "t.sup", "password": "pass@12345"})
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")

    def test_super_admin_counts_as_admin(self):
        from .models import is_top_admin
        self.assertTrue(is_top_admin(Role.SUPER_ADMIN))
        self.assertTrue(is_top_admin(Role.ADMIN))
        self.assertFalse(is_top_admin(Role.SALES_MANAGER))
        self.assertTrue(self.sup.is_admin_role)

    def test_super_admin_passes_the_admin_only_permission(self):
        from rest_framework.test import APIRequestFactory
        from .permissions import IsAdmin
        req = APIRequestFactory().get("/")
        req.user = self.sup
        self.assertTrue(IsAdmin().has_permission(req, None))

    def test_making_someone_super_admin_needs_no_reports_to(self):
        """Nobody sits above them."""
        emp = User.objects.create_user("t.emp", "e@x.com", "pass@12345",
                                       role=Role.SALES_EXECUTIVE, department="sales",
                                       whatsapp_phone="9876543210", reporting_manager=self.sup)
        res = self.client.patch(f"/api/users/{emp.id}/",
                                {"role": Role.SUPER_ADMIN, "reporting_manager": None},
                                format="json")
        self.assertEqual(res.status_code, 200, res.data)

    def test_super_admin_can_delete_a_lead(self):
        from crm.models import Lead
        lead = Lead.objects.create(customer_name="X", department="sales")
        self.assertEqual(self.client.delete(f"/api/leads/{lead.id}/").status_code, 204)

    def test_super_admin_gets_the_staff_flag_like_an_admin(self):
        self.sup.save()
        self.sup.refresh_from_db()
        self.assertTrue(self.sup.is_staff)

    def test_no_code_compares_to_admin_alone_any_more(self):
        """The guard against the next one: a role check written as
        `== Role.ADMIN` would shut Super Admin out again."""
        import pathlib, re
        root = pathlib.Path(__file__).resolve().parent.parent
        offenders = []
        for f in root.rglob("*.py"):
            s = str(f)
            if "migrations" in s or "test" in f.name or "venv" in s:
                continue
            for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r"role\s*[!=]=\s*Role\.ADMIN", line):
                    offenders.append(f"{f.relative_to(root)}:{i}")
        # the role guard legitimately tells Admin and Super Admin apart
        offenders = [o for o in offenders if not o.startswith("accounts" + chr(92) + "views.py")
                     and not o.startswith("accounts/views.py")]
        self.assertEqual(offenders, [], f"compare with is_top_admin() instead: {offenders}")
