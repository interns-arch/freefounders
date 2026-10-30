import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { BillingService } from '../billing/billing.service';
import { DbService } from '../db/db.service';
import { APPS, type AppKey, companies, type ModuleSwitches, staffAudit, subscriptions } from '../db/schema';
import { internalUrl, ProvisionClient } from '../provision/provision.client';
import { CompanyService } from './company.service';
import { CompanySetupService } from './setup.service';

type Say = (line: string) => void;

/** What `company -- grant --complimentary --all-modules` would set (dry run) or did. */
export interface GrantPlan {
  company: { id: string; code: string; name: string; enabledApps: string[] };
  before: { plan: string; state: string; modules: string[] | null; ai: boolean; trialEndsAt: Date | null; trialMaxUsers: number | null; setupPending: boolean } | null;
  /** Every module of every app, switched on. */
  modules: ModuleSwitches;
  /** Apps that could not be asked for their module list (switches left as they are there). */
  problems: string[];
}

/**
 * Everything unlocked for good (founder, 2026-10-30): the complimentary plan (never expires, never read-only, no user
 * limit, no billing), Tasks + Attendance + Assets + Visitors + Payroll (no module list = every plan area), the AI
 * helper, and every module switch of every app on. The same plan the console's "Set plan → Complimentary" gives,
 * plus AI and all switches; then the profile is pushed to the apps (same push as `company -- sync`).
 */
@Injectable()
export class CompanyGrantService {
  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get billing() {
    return this.moduleRef.get(BillingService, { strict: false });
  }
  private get setup() {
    return this.moduleRef.get(CompanySetupService, { strict: false });
  }
  private get company() {
    return this.moduleRef.get(CompanyService, { strict: false });
  }

  async plan(code: string): Promise<GrantPlan | null> {
    const [c] = await this.dbs.db.select().from(companies).where(eq(companies.code, code.trim().toUpperCase())).limit(1);
    if (!c) return null;
    const [s] = await this.dbs.db.select().from(subscriptions).where(eq(subscriptions.companyId, c.id)).limit(1);
    const modules: ModuleSwitches = structuredClone(c.modules ?? {});
    const problems: string[] = [];
    for (const app of APPS) {
      if (!internalUrl(app)) {
        problems.push(`${app}: not connected (${app.toUpperCase()}_INTERNAL_URL is not set)`);
        continue;
      }
      try {
        const cat = await this.provisioner.modules(app, c.id).catch(async (err) => {
          // A company not yet set up in an app cannot answer for it; the app's catalogue is the same for everyone.
          if (c.enabledApps.includes(app)) throw err;
          return null;
        });
        if (cat) modules[app] = Object.fromEntries(cat.modules.map((m) => [m.key, true]));
      } catch (err) {
        problems.push(`${app}: ${(err as Error).message}`);
      }
    }
    return {
      company: { id: c.id, code: c.code, name: c.name, enabledApps: c.enabledApps },
      before: s ? { plan: s.plan, state: s.state, modules: s.modules, ai: s.ai, trialEndsAt: s.trialEndsAt, trialMaxUsers: s.trialMaxUsers, setupPending: s.setupPending } : null,
      modules,
      problems,
    };
  }

  describe(p: GrantPlan, say: Say) {
    const b = p.before;
    say(`${p.company.name} (${p.company.code})  apps [${p.company.enabledApps.join(', ')}]`);
    say(`  now:   ${b ? `${b.plan} / ${b.state}${b.modules ? ` modules ${b.modules.join('+')}` : ''}${b.ai ? ' + AI' : ''}${b.trialEndsAt ? ` trial ends ${b.trialEndsAt.toISOString().slice(0, 10)}` : ''}${b.trialMaxUsers ? ` max ${b.trialMaxUsers} users` : ''}${b.setupPending ? ' (apps not set up yet)' : ''}` : 'no subscription row'}`);
    say('  after: complimentary / active, all plan areas (Tasks, Attendance, Assets, Visitors, Payroll) + AI, no user limit, never expires');
    say(`  apps:  tasks, assets`);
    for (const [app, sw] of Object.entries(p.modules)) say(`  ${app} modules on: ${Object.keys(sw ?? {}).join(', ') || '(none listed)'}`);
    for (const x of p.problems) say(`  ! ${x}`);
  }

  async run(code: string, by: string, say: Say): Promise<GrantPlan> {
    const p = await this.plan(code);
    if (!p) throw new Error(`No company with code ${code.trim().toUpperCase()}`);
    if (p.problems.length) throw new Error(`Could not read every app's modules: ${p.problems.join('; ')}`);
    const id = p.company.id;
    const values = {
      plan: 'complimentary',
      state: 'active',
      stateSince: new Date(),
      modules: null,
      ai: true,
      seats: 0,
      nextPeriodSeats: null,
      trialEndsAt: null,
      trialMaxUsers: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      gateway: null,
      payBy: null,
      freeFallback: false,
      updatedAt: new Date(),
    };
    await this.dbs.db
      .insert(subscriptions)
      .values({ companyId: id, ...values })
      .onConflictDoUpdate({ target: subscriptions.companyId, set: values });
    say('  ✔ plan: complimentary / active, all areas + AI, no user limit');
    // A "Buy now" company gets its apps now; anyone else gets the apps it is missing.
    if (p.before?.setupPending) {
      if (!(await this.billing.finishSetup(id))) throw new Error('Setting up the apps failed; run it again (or company -- sync)');
    } else {
      const added = APPS.filter((a) => !p.company.enabledApps.includes(a));
      if (added.length) {
        await this.dbs.db.update(companies).set({ enabledApps: [...APPS], updatedAt: new Date() }).where(eq(companies.id, id));
        await this.setup.addApps(id, added as AppKey[]);
        say(`  ✔ apps added: ${added.join(', ')}`);
      }
    }
    // The module list again: an app just set up answers now.
    const fresh = await this.plan(code);
    const modules = fresh && !fresh.problems.length ? fresh.modules : p.modules;
    await this.dbs.db.update(companies).set({ modules, status: 'active', updatedAt: new Date() }).where(eq(companies.id, id));
    const pushed = await this.company.push(id);
    say(`  ✔ every module on; profile sent to ${Object.entries(pushed).map(([a, r]) => `${a} (${r})`).join(', ') || 'no app'}`);
    await this.dbs.db.insert(staffAudit).values({
      staffEmail: by,
      action: 'company.grant',
      companyId: id,
      companyCode: p.company.code,
      details: { grant: 'complimentary-all-modules', by, osUser: process.env.USER ?? process.env.USERNAME ?? null, before: p.before, modules, pushed },
    });
    say('  ✔ staff audit: company.grant written');
    return { ...p, modules };
  }
}
