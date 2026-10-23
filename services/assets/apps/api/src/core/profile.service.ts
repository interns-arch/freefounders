import { type CanActivate, type ExecutionContext, Injectable, NotFoundException, SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { syncState } from '../db/schema';

/**
 * The company profile from the Kaampilot Platform (PLAN.md §16): names, colour, logo and module switches.
 * Kept in the company's own sync_state table. An install that never received one (standalone) has every module on
 * and keeps its own look.
 */
export const PROFILE_KEY = 'ff_profile';
export const PROFILE_VERSION_KEY = 'ff_profile_version';

/** Parts of Assets a company can switch off. Everything else is always on. */
export const MODULES = [
  {
    key: 'sims',
    label: 'SIM register & reconciliation',
    description: 'SIM cards and matching them against the Airtel / Salary Box bills',
    default: false,
  },
] as const;
export type ModuleKey = (typeof MODULES)[number]['key'];

export const profilePushSchema = z.object({
  version: z.number().int().min(0),
  name: z.string().max(200).nullable().optional(),
  shortName: z.string().max(60).nullable().optional(),
  colour: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  modules: z.record(z.string(), z.boolean()).optional(),
});

export interface CompanyProfile {
  name: string;
  shortName: string | null;
  colour: string | null;
  logoUrl: string | null;
  modules: Partial<Record<ModuleKey, boolean>>;
}

@Injectable()
export class ProfileService {
  constructor(private readonly dbs: DbService) {}

  async get(): Promise<CompanyProfile | null> {
    const [row] = await this.dbs.db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, PROFILE_KEY)).limit(1);
    if (!row) return null;
    try {
      const data = JSON.parse(row.value) as CompanyProfile;
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  /** On unless the company switched it off. */
  async moduleOn(key: ModuleKey): Promise<boolean> {
    return (await this.get())?.modules?.[key] !== false;
  }

  async modules(): Promise<Record<ModuleKey, boolean>> {
    const p = await this.get();
    return Object.fromEntries(MODULES.map((m) => [m.key, p?.modules?.[m.key] !== false])) as Record<ModuleKey, boolean>;
  }

  /** Stores a profile pushed by the Platform. An older version arriving late is ignored. */
  async apply(input: z.infer<typeof profilePushSchema>) {
    return this.dbs.tx(async (db) => {
      const [row] = await db.select({ value: syncState.value }).from(syncState).where(eq(syncState.key, PROFILE_VERSION_KEY)).limit(1);
      const current = row ? Number(row.value) || 0 : 0;
      if (input.version < current) return { version: current, applied: false };
      const known = new Set<string>(MODULES.map((m) => m.key));
      const profile: CompanyProfile = {
        name: (input.name ?? '').slice(0, 200),
        shortName: input.shortName?.slice(0, 60) || null,
        colour: input.colour && /^#[0-9a-f]{6}$/i.test(input.colour) ? input.colour : null,
        logoUrl: input.logoUrl && input.logoUrl.startsWith('/') && !input.logoUrl.startsWith('//') ? input.logoUrl : null,
        modules: Object.fromEntries(Object.entries(input.modules ?? {}).filter(([k]) => known.has(k))),
      };
      for (const [key, value] of [
        [PROFILE_KEY, JSON.stringify(profile)],
        [PROFILE_VERSION_KEY, String(input.version)],
      ]) {
        await db.insert(syncState).values({ key, value }).onConflictDoUpdate({ target: syncState.key, set: { value } });
      }
      return { version: input.version, applied: true };
    });
  }
}

const MODULE_KEY = 'eam:module';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly profile: ProfileService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<ModuleKey | undefined>(MODULE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (key && !(await this.profile.moduleOn(key))) throw new NotFoundException('This module is switched off');
    return true;
  }
}

/** The routes belong to a module the company can switch off; then they answer 404 (PLAN.md §16.2). */
export const RequireModule = (key: ModuleKey) => applyDecorators(SetMetadata(MODULE_KEY, key), UseGuards(ModuleGuard));
