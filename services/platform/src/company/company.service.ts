import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, type Caller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { assertCompanyNameFree, cleanCompanyName, normaliseCompanyName } from './company-name';
import { type AppKey, APPS, companies, type ModuleSwitches } from '../db/schema';
import { type AppModule, internalUrl, ProvisionClient } from '../provision/provision.client';

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  shortName: z.string().trim().max(40).nullable(),
  colour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2457f5')
    .nullable(),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const logoSchema = z.object({ image: z.string().max(800_000) });
export const modulesSchema = z.record(z.string(), z.record(z.string(), z.boolean()));

const LOGO_MAX = 512 * 1024;

/** PNG, JPEG or WebP, judged by the file's first bytes (never by what the browser claims). */
export function imageType(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export interface AppModuleState {
  app: AppKey;
  modules: Array<AppModule & { on: boolean }>;
}

/** Company profile for the Settings Center: branding and module switches. The Platform owns them; the apps get a copy. */
@Injectable()
export class CompanyService {
  private readonly log = new Logger('Company');

  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
  ) {}

  private async row(companyId: string) {
    const [c] = await this.dbs.db
      .select({
        id: companies.id,
        name: companies.name,
        code: companies.code,
        shortName: companies.shortName,
        colour: companies.brandColour,
        hasLogo: sql<boolean>`${companies.logo} is not null`,
        enabledApps: companies.enabledApps,
        modules: companies.modules,
        profileVersion: companies.profileVersion,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!c) throw notFound('Company');
    return c;
  }

  private connectedApps(enabled: string[]): AppKey[] {
    return enabled.filter((a): a is AppKey => (APPS as readonly string[]).includes(a));
  }

  /** Same-origin address of the logo; the version makes browsers fetch the new one after a change. */
  static logoUrl(c: { id: string; hasLogo: boolean; profileVersion: number }): string | null {
    return c.hasLogo ? `/api/platform/brand/${c.id}/logo?v=${c.profileVersion}` : null;
  }

  /** What each app can switch on or off (from the apps themselves), with the company's current choice. */
  async catalogue(companyId: string, enabled: string[], switches: ModuleSwitches): Promise<AppModuleState[]> {
    const out: AppModuleState[] = [];
    for (const app of this.connectedApps(enabled)) {
      if (!internalUrl(app)) continue;
      try {
        const cat = await this.provisioner.modules(app, companyId);
        out.push({ app, modules: cat.modules.map((m) => ({ ...m, on: switches[app]?.[m.key] ?? !m.optIn })) });
      } catch (err) {
        this.log.warn(`Module list from ${app}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  async get(caller: Caller) {
    const c = await this.row(caller.companyId);
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      shortName: c.shortName,
      colour: c.colour,
      logoUrl: CompanyService.logoUrl(c),
      apps: this.connectedApps(c.enabledApps),
      modules: await this.catalogue(c.id, c.enabledApps, c.modules),
    };
  }

  /** Branding as the portal shows it (no module list, no app calls). */
  async brand(companyId: string) {
    const c = await this.row(companyId);
    return { id: c.id, name: c.name, shortName: c.shortName, colour: c.colour, logoUrl: CompanyService.logoUrl(c) };
  }

  async update(caller: Caller, input: Partial<ProfileInput>) {
    const set: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
    if (input.shortName !== undefined) set.shortName = input.shortName || null;
    if (input.colour !== undefined) set.brandColour = input.colour ? input.colour.toLowerCase() : null;
    await this.dbs.tx(async () => {
      if (input.name !== undefined) {
        // A new name must be free across the product (PLAN.md §21.6); saving the current one (even an older duplicate
        // or a longer name) is always allowed.
        const [current] = await this.dbs.db.select({ name: companies.name }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
        if (!current || normaliseCompanyName(current.name) !== normaliseCompanyName(input.name)) set.name = await assertCompanyNameFree(this.dbs.db, input.name, caller.companyId);
        else if (cleanCompanyName(current.name) !== cleanCompanyName(input.name)) set.name = input.name;
      }
      await this.dbs.db.update(companies).set(set).where(eq(companies.id, caller.companyId));
    });
    const sync = await this.push(caller.companyId);
    return { ...(await this.get(caller)), sync };
  }

  async setLogo(caller: Caller, image: string | null) {
    let logo: Buffer | null = null;
    let logoType: string | null = null;
    if (image) {
      const m = /^data:[\w/+.-]*;base64,(.+)$/s.exec(image);
      logo = Buffer.from(m ? m[1] : image, 'base64');
      if (logo.length > LOGO_MAX) throw badRequest('The logo must be at most 512 KB', { image: 'At most 512 KB' });
      logoType = imageType(logo);
      if (!logoType) throw badRequest('The logo must be a PNG, JPEG or WebP image', { image: 'PNG, JPEG or WebP only' });
    }
    await this.dbs.db.update(companies).set({ logo, logoType, updatedAt: new Date() }).where(eq(companies.id, caller.companyId));
    const sync = await this.push(caller.companyId);
    return { ...(await this.brand(caller.companyId)), sync };
  }

  async logo(companyId: string): Promise<{ data: Buffer; type: string } | null> {
    const [c] = await this.dbs.db.select({ data: companies.logo, type: companies.logoType }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return c?.data && c.type ? { data: c.data, type: c.type } : null;
  }

  /** Switches modules on or off. Only modules the app offers, in apps the company's plan includes. */
  async setModules(caller: Caller, wanted: ModuleSwitches) {
    const c = await this.row(caller.companyId);
    const cat = await this.catalogue(c.id, c.enabledApps, c.modules);
    const next: ModuleSwitches = structuredClone(c.modules ?? {});
    for (const [app, switches] of Object.entries(wanted)) {
      const offered = cat.find((x) => x.app === app);
      if (!offered) throw badRequest(`Your plan does not include ${app}`);
      for (const [key, on] of Object.entries(switches ?? {})) {
        if (!offered.modules.some((m) => m.key === key)) throw badRequest(`${app} has no module "${key}"`);
        next[app as AppKey] = { ...(next[app as AppKey] ?? {}), [key]: on };
      }
    }
    await this.dbs.db.update(companies).set({ modules: next, updatedAt: new Date() }).where(eq(companies.id, caller.companyId));
    const sync = await this.push(caller.companyId);
    return { ...(await this.get(caller)), sync };
  }

  /**
   * New company: write each app's launch defaults (§16.2), so a later change of a default never flips an existing
   * company's modules. Existing and imported companies keep `{}` (everything on).
   */
  async applyLaunchDefaults(companyId: string) {
    const c = await this.row(companyId);
    const next: ModuleSwitches = {};
    for (const app of this.connectedApps(c.enabledApps)) {
      if (!internalUrl(app)) continue;
      const cat = await this.provisioner.modules(app, companyId);
      next[app] = Object.fromEntries(cat.modules.map((m) => [m.key, m.default]));
    }
    await this.dbs.db.update(companies).set({ modules: next }).where(eq(companies.id, companyId));
  }

  /** An app added later (plan upgrade, PLAN.md §21): its launch defaults, unless the company already chose its modules. */
  async applyLaunchDefaultsFor(companyId: string, apps: AppKey[]) {
    const c = await this.row(companyId);
    const next: ModuleSwitches = structuredClone(c.modules ?? {});
    for (const app of apps) {
      if (!internalUrl(app) || next[app]) continue;
      try {
        const cat = await this.provisioner.modules(app, companyId);
        next[app] = Object.fromEntries(cat.modules.map((m) => [m.key, m.default]));
      } catch (err) {
        this.log.warn(`Module defaults from ${app}: ${(err as Error).message}`);
      }
    }
    await this.dbs.db.update(companies).set({ modules: next }).where(eq(companies.id, companyId));
  }

  /**
   * Sends the profile to every connected app. Never throws: failures are reported and logged; `npm run company -- sync`
   * sends it again. An app ahead of the Platform (e.g. a restored backup) makes us move past its version and resend once.
   */
  async push(companyId: string, { retried = false } = {}): Promise<Record<string, string>> {
    const db = this.dbs.db;
    await db.update(companies).set({ profileVersion: sql`${companies.profileVersion} + 1` }).where(eq(companies.id, companyId));
    const c = await this.row(companyId);
    const result: Record<string, string> = {};
    let ahead = 0;
    for (const app of this.connectedApps(c.enabledApps)) {
      if (!internalUrl(app)) continue;
      try {
        const res = await this.provisioner.pushCompany(app, companyId, {
          version: c.profileVersion,
          name: c.name,
          shortName: c.shortName,
          colour: c.colour,
          logoUrl: CompanyService.logoUrl(c),
          modules: c.modules?.[app] ?? {},
        });
        result[app] = res.applied ? 'ok' : 'stale';
        if (!res.applied && typeof res.version === 'number') ahead = Math.max(ahead, res.version);
      } catch (err) {
        result[app] = `failed: ${(err as Error).message}`;
        this.log.error(`Profile sync to ${app} failed for company ${companyId}: ${(err as Error).message}`);
      }
    }
    if (ahead && !retried) {
      await db.update(companies).set({ profileVersion: sql`greatest(${companies.profileVersion}, ${ahead})` }).where(eq(companies.id, companyId));
      return this.push(companyId, { retried: true });
    }
    return result;
  }
}
