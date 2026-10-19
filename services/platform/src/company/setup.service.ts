import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { accounts, type AppKey, APPS, companies, invites, logins, people, personApps, personRoles, refreshSessions, roles } from '../db/schema';
import { DirectoryService } from '../people/directory.service';
import { internalUrl, ProvisionClient } from '../provision/provision.client';
import { ADMIN, MEMBER, RolesService } from '../roles/roles.service';
import { CompanyService } from './company.service';

/** Same rule as `npm run company -- create --code`. */
export const CODE_RE = /^[A-Za-z][A-Za-z0-9_]{1,40}$/;

type Say = (line: string) => void;

/**
 * Bringing a company into the apps: shared by `npm run company -- create|sync` (src/companies.ts), self-serve sign-up
 * and plan changes (PLAN.md §21). Every step can be repeated safely.
 */
@Injectable()
export class CompanySetupService {
  private readonly log = new Logger('CompanySetup');

  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get roles() {
    return this.moduleRef.get(RolesService, { strict: false });
  }
  private get company() {
    return this.moduleRef.get(CompanyService, { strict: false });
  }
  private get directory() {
    return this.moduleRef.get(DirectoryService, { strict: false });
  }

  private connected(apps: string[]): AppKey[] {
    return apps.filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
  }

  /** A free company code made from the name (letters/digits, starting with a letter), e.g. "Acme Pvt Ltd" → ACMEPVTLTD. */
  async freeCode(name: string): Promise<string> {
    let base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    if (!/^[A-Z]/.test(base)) base = `C${base}`;
    if (base.length < 2) base = `${base}CO`;
    for (let i = 0; i < 50; i++) {
      const code = i === 0 ? base : `${base.slice(0, 16)}${i + 1}`;
      if (!CODE_RE.test(code)) continue;
      const [taken] = await this.dbs.db.select({ id: companies.id }).from(companies).where(eq(companies.code, code)).limit(1);
      if (!taken) return code;
    }
    return `${base.slice(0, 12)}${Math.floor(Math.random() * 1e6)}`;
  }

  /** Sets the company up in each of these apps (default: every app it has) that is connected. */
  async setUpInApps(company: { id: string; code: string; name: string; enabledApps: string[] }, say: Say = () => {}, only?: AppKey[]) {
    for (const app of this.connected(company.enabledApps).filter((a) => !only || only.includes(a))) {
      if (!internalUrl(app)) {
        say(`  • ${app}: skipped (${app.toUpperCase()}_INTERNAL_URL is not set)`);
        continue;
      }
      const res = await this.provisioner.setUpCompany(app, { companyId: company.id, code: company.code, name: company.name });
      say(`  ✔ ${app}: ${res.created ? 'set up' : 'up to date'} (${res.schema})`);
    }
  }

  /**
   * Provisions every person who already has an app again and stores the app's user id. Provisioning finds the person's
   * existing user first, so this changes nothing when all is well, and repairs the links after an app's data moved.
   */
  async relink(companyId: string, say: Say = () => {}) {
    const grants = await this.dbs.db
      .select({ personId: people.id, fullName: people.fullName, email: people.email, employeeCode: people.employeeCode, mobile: people.mobile, platformRole: people.platformRole, username: logins.username, app: personApps.app, localUserId: personApps.localUserId })
      .from(personApps)
      .innerJoin(people, eq(people.id, personApps.personId))
      .leftJoin(logins, eq(logins.personId, people.id))
      .where(eq(people.companyId, companyId));
    let changed = 0;
    for (const g of grants) {
      if (!(APPS as readonly string[]).includes(g.app) || !internalUrl(g.app as AppKey)) continue;
      try {
        const localUserId = await this.provisioner.provision(g.app as AppKey, companyId, {
          personId: g.personId,
          fullName: g.fullName,
          email: g.email,
          employeeCode: g.employeeCode,
          mobile: g.mobile,
          username: g.username,
          platformRole: g.platformRole,
        });
        if (localUserId !== g.localUserId) {
          await this.dbs.db.update(personApps).set({ localUserId }).where(and(eq(personApps.personId, g.personId), eq(personApps.app, g.app)));
          changed++;
        }
      } catch (err) {
        say(`  ✖ ${g.fullName} in ${g.app}: ${(err as Error).message}`);
      }
    }
    if (grants.length) say(`  ✔ ${grants.length} app access link(s) checked, ${changed} updated`);
  }

  /** Brings the company into the role builder (first time) and sends every app the current roles. */
  async syncRoles(companyId: string, say: Say = () => {}) {
    if (!APPS.some((a) => internalUrl(a))) return;
    try {
      const res = await this.roles.sync(companyId);
      say(`  ✔ roles: ${res.imported ? 'imported from the apps, ' : ''}sent to ${Object.entries(res.push).map(([a, r]) => `${a} (${r})`).join(', ') || 'no app'}`);
    } catch (err) {
      say(`  ✖ roles: ${(err as Error).message}`);
      this.log.warn(`Roles for company ${companyId}: ${(err as Error).message}`);
    }
  }

  /** Brings the company into the People directory (first time) and sends it to every app. */
  async syncPeople(companyId: string, say: Say = () => {}) {
    if (!APPS.some((a) => internalUrl(a))) return;
    try {
      const res = await this.directory.sync(companyId);
      say(`  ✔ people: ${res.imported ? 'imported from the apps, ' : ''}sent to ${Object.entries(res.push).map(([a, r]) => `${a} (${r})`).join(', ') || 'no app'}`);
    } catch (err) {
      say(`  ✖ people: ${(err as Error).message}`);
      this.log.warn(`People for company ${companyId}: ${(err as Error).message}`);
    }
  }

  /** Sends every app the company's names, colour, logo address and module switches. */
  async syncProfile(companyId: string, say: Say = () => {}) {
    if (!APPS.some((a) => internalUrl(a))) return;
    const res = await this.company.push(companyId);
    say(`  ✔ profile: sent to ${Object.entries(res).map(([a, r]) => `${a} (${r})`).join(', ') || 'no app'}`);
  }

  /**
   * `company -- reset --code X --keep-owner` (PLAN.md §19.28), for local test companies only: everyone but the owner(s)
   * is deleted with every record of theirs in every app (the same "delete everything" path as Admin → People →
   * Delete), Tasks' users that belong to no person go too, every role but Admin and Member is archived, and Admin and
   * Member start again from their default permissions. With `keepStaff`, FreeFounders staff accounts keep their
   * membership (no roles, no apps) so they can still open the owner console. Company settings, departments, asset
   * catalogue, leave types, locations and HR rules stay.
   */
  async resetToOwner(companyId: string, { keepStaff = true } = {}, say: Say = () => {}) {
    const db = this.dbs.db;
    const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!c) throw new Error('No such company');
    const owners = await db.select({ id: people.id }).from(people).where(and(eq(people.companyId, companyId), eq(people.platformRole, 'owner')));
    if (!owners.length) throw new Error('The company has no owner: nothing to keep');
    // Without the apps' addresses the people would go here but every record of theirs would stay in Tasks / Assets.
    const unreachable = this.connected(c.enabledApps).filter((a) => !internalUrl(a));
    if (unreachable.length) {
      throw new Error(
        `${unreachable.map((a) => `${a.toUpperCase()}_INTERNAL_URL`).join(' and ')} not set: the apps could not delete the people's records. ` +
          'Run it with the internal addresses of the apps (e.g. TASKS_INTERNAL_URL=http://127.0.0.1:8000/api/internal ASSETS_INTERNAL_URL=http://127.0.0.1:3000/api/internal).',
      );
    }
    const staff = keepStaff
      ? (
          await db
            .select({ id: people.id })
            .from(people)
            .innerJoin(accounts, eq(accounts.id, people.accountId))
            .where(and(eq(people.companyId, companyId), eq(accounts.isStaff, true), ne(people.platformRole, 'owner')))
        ).map((p) => p.id)
      : [];
    const keep = [...owners.map((o) => o.id), ...staff];
    const others = await db.select({ id: people.id, fullName: people.fullName }).from(people).where(and(eq(people.companyId, companyId), notInArray(people.id, keep)));
    const apps = this.connected(c.enabledApps).filter((a) => internalUrl(a));
    say(`  • ${others.length} people to delete (keeping ${owners.length} owner(s)${staff.length ? ` and ${staff.length} staff account(s)` : ''})`);
    const failed: string[] = [];
    let n = 0;
    for (const p of others) {
      // Off first, so nothing new is written about them while the apps delete.
      await db.update(people).set({ status: 'inactive', updatedAt: new Date() }).where(eq(people.id, p.id));
      let ok = true;
      for (const app of apps) {
        try {
          await this.provisioner.deletePerson(app, companyId, p.id);
        } catch (err) {
          ok = false;
          failed.push(`${p.fullName} in ${app}: ${(err as Error).message}`);
        }
      }
      if (!ok) continue;
      await db.transaction(async (tx) => {
        await tx.update(people).set({ reportsTo: null }).where(eq(people.reportsTo, p.id));
        await tx.delete(logins).where(eq(logins.personId, p.id));
        await tx.delete(refreshSessions).where(eq(refreshSessions.personId, p.id));
        await tx.delete(personRoles).where(eq(personRoles.personId, p.id));
        await tx.delete(personApps).where(eq(personApps.personId, p.id));
        await tx.delete(people).where(eq(people.id, p.id));
      });
      if (++n % 50 === 0) say(`  • ${n} deleted…`);
    }
    say(`  ✔ ${n} people deleted${failed.length ? `; ${failed.length} failed (kept, switched off):` : ''}`);
    for (const f of failed.slice(0, 20)) say(`    ✖ ${f}`);
    if (apps.includes('tasks')) {
      const res = await this.provisioner.deleteUnlinked(companyId);
      say(`  ✔ tasks: ${res.deleted} user(s) not linked to anyone deleted`);
    }
    // Staff kept: a membership without roles or apps (the owner console needs only the account).
    for (const id of staff) {
      await db.delete(personApps).where(eq(personApps.personId, id));
      await db.delete(personRoles).where(eq(personRoles.personId, id));
      await db.update(people).set({ platformRole: 'member', reportsTo: null, updatedAt: new Date() }).where(eq(people.id, id));
    }
    await db.update(people).set({ reportsTo: null }).where(eq(people.companyId, companyId));
    await db.delete(invites).where(eq(invites.companyId, companyId));
    // Only Admin and Member, at their defaults; the hidden Owner role stays (personal roles go).
    const archived = await db
      .update(roles)
      .set({ archived: true, updatedAt: new Date() })
      .where(and(eq(roles.companyId, companyId), eq(roles.kind, 'role'), eq(roles.archived, false), notInArray(roles.code, [ADMIN.code, MEMBER.code])))
      .returning({ id: roles.id });
    if (archived.length) await db.delete(personRoles).where(inArray(personRoles.roleId, archived.map((r) => r.id)));
    await db.delete(roles).where(and(eq(roles.companyId, companyId), eq(roles.kind, 'personal')));
    await this.roles.resetBuiltIns(companyId);
    await db.update(people).set({ status: 'active' }).where(and(eq(people.companyId, companyId), inArray(people.id, keep), ne(people.status, 'active')));
    say(`  ✔ roles: ${archived.length} archived; Admin and Member back to their defaults`);
    await this.sync(c, say);
  }

  /** `company -- sync` for one company. */
  async sync(company: { id: string; code: string; name: string; enabledApps: string[] }, say: Say = () => {}) {
    await this.setUpInApps(company, say);
    await this.relink(company.id, say);
    await this.syncRoles(company.id, say);
    await this.syncProfile(company.id, say);
    await this.syncPeople(company.id, say);
  }

  /**
   * A company just created (rows written): set it up in its apps with the launch modules (§16.2), bring it into the role
   * builder (the owner gets Super Admin and, through it, the apps), then send profile and people. Same as `company -- create`.
   */
  async provisionNew(company: { id: string; code: string; name: string; enabledApps: string[] }, say: Say = () => {}) {
    await this.setUpInApps(company, say);
    if (APPS.some((a) => internalUrl(a))) await this.company.applyLaunchDefaults(company.id);
    await this.syncRoles(company.id, say);
    await this.syncProfile(company.id, say);
    await this.syncPeople(company.id, say);
  }

  /**
   * Apps added to an existing company (a plan upgrade): set up there with that app's launch modules, the Owner role
   * follows the catalogue, and everyone whose roles reach the app gets it.
   */
  async addApps(companyId: string, added: AppKey[]) {
    const [c] = await this.dbs.db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!c || !added.length) return;
    await this.setUpInApps(c, (l) => this.log.log(l.trim()), added);
    await this.company.applyLaunchDefaultsFor(companyId, added);
    await this.roles.push(companyId);
    await this.roles.openAppsFromRoles(companyId);
    await this.company.push(companyId);
    await this.directory.push(companyId);
  }
}
