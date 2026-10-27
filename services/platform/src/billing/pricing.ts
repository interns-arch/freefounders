import { BadRequestException } from '@nestjs/common';
import type { AppKey, modulePrices, plans } from '../db/schema';

/**
 * Module-wise pricing (PLAN.md §24.1). Prices are data (`plans`, `module_prices`); this file only combines them:
 * plan `modules` = the picked modules (each priced per user per month, with or without AI), plan `complete` = every
 * module at one price. AI is one switch for the whole subscription. Yearly = 10 × monthly. GST comes on top (gst.ts).
 */
export const MODULE_KEYS = ['tasks', 'attendance', 'assets'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];
export const isModuleKey = (v: unknown): v is ModuleKey => typeof v === 'string' && (MODULE_KEYS as readonly string[]).includes(v);

type PlanRow = typeof plans.$inferSelect;
type ModulePriceRow = typeof modulePrices.$inferSelect;

/** What is bought: a plan code, the picked modules (plan `modules` only) and AI. */
export interface Selection {
  plan: string;
  modules: ModuleKey[] | null;
  ai: boolean;
}

/** The modules in a fixed order, without repeats or unknown keys. */
export const cleanModules = (list: readonly unknown[] | null | undefined): ModuleKey[] => MODULE_KEYS.filter((k) => (list ?? []).includes(k));

/**
 * A checkout request in today's terms. Older clients (a cached web app, an older phone app) still send the plans sold
 * before §24.1; they mean the same modules now: Tasks plan = Tasks + Attendance, Assets plan = Assets, Suite = Complete.
 */
export function normaliseSelection(input: { plan: string; modules?: readonly string[] | null; ai?: boolean }): Selection {
  const ai = !!input.ai;
  switch (input.plan) {
    case 'complete':
    case 'suite':
      return { plan: 'complete', modules: null, ai };
    case 'tasks':
      return { plan: 'modules', modules: ['tasks', 'attendance'], ai };
    case 'assets':
      return { plan: 'modules', modules: ['assets'], ai };
    case 'modules': {
      const modules = cleanModules(input.modules);
      if (!modules.length) throw new BadRequestException({ message: 'Choose at least one module', errors: { modules: 'Choose at least one module' } });
      // All three picked one by one cost more than Complete would; still allowed (the screen suggests Complete).
      return { plan: 'modules', modules, ai };
    }
    default:
      return { plan: input.plan, modules: null, ai };
  }
}

/** Per user per month, in paise. */
export function perUserMonthly(plan: PlanRow, sel: { modules: readonly string[] | null; ai: boolean }, catalogue: ModulePriceRow[]): number {
  if (plan.kind === 'pick') {
    const picked = cleanModules(sel.modules);
    return catalogue.filter((m) => picked.includes(m.key as ModuleKey)).reduce((sum, m) => sum + (sel.ai ? m.aiPriceMonthly : m.priceMonthly), 0);
  }
  return sel.ai && plan.aiPriceMonthly > 0 ? plan.aiPriceMonthly : plan.priceMonthly;
}

/** Per user for one period of `interval`. Older plans keep their own yearly price; the §24.1 plans are 10 × monthly. */
export function unitPrice(plan: PlanRow, sel: { modules: readonly string[] | null; ai: boolean }, catalogue: ModulePriceRow[], interval: string): number {
  const month = perUserMonthly(plan, sel, catalogue);
  if (interval !== 'year') return month;
  return plan.kind === 'plan' && !sel.ai ? plan.priceYearly : month * 10;
}

/** "Complete", "Complete with AI", "Tasks + Attendance with AI"; an older plan by its name. */
export function selectionName(plan: PlanRow, sel: { modules: readonly string[] | null; ai: boolean }, catalogue: ModulePriceRow[]): string {
  const name =
    plan.kind === 'pick'
      ? cleanModules(sel.modules)
          .map((k) => catalogue.find((m) => m.key === k)?.name ?? k)
          .join(' + ') || plan.name
      : plan.name;
  return sel.ai && (plan.kind !== 'plan' || plan.aiPriceMonthly > 0) ? `${name} with AI` : name;
}

/** The apps a plan opens: Tasks and Attendance live in the Tasks app, Assets in the Assets app. */
export function appsFor(plan: PlanRow, modules: readonly string[] | null): AppKey[] {
  if (plan.kind !== 'pick') return plan.apps.filter((a): a is AppKey => a === 'tasks' || a === 'assets');
  const picked = cleanModules(modules);
  const out: AppKey[] = [];
  if (picked.includes('tasks') || picked.includes('attendance')) out.push('tasks');
  if (picked.includes('assets')) out.push('assets');
  return out;
}

/** The plan's modules for the menus (null = no limit: Complete, the trial, older and complimentary plans). */
export function planModules(plan: Pick<PlanRow, 'kind'>, modules: readonly string[] | null): ModuleKey[] | null {
  return plan.kind === 'pick' ? cleanModules(modules) : null;
}

/**
 * The Tasks app's own module switches (§16) and what unlocks each: the Tasks module (leads, AI inbox, mistakes, links)
 * or only Complete (Visitors, Payroll). Modules not listed (tasks, groups, notices, attendance) are always on in the app.
 */
export const TASKS_MODULE_NEEDS: Record<string, ModuleKey | 'complete'> = {
  leads: 'tasks',
  intake: 'tasks',
  mistakes: 'tasks',
  links: 'tasks',
  payroll: 'complete',
  visitors: 'complete',
};

/** May this Tasks-app module be on under this plan? */
export function tasksModuleAllowed(key: string, plan: Pick<PlanRow, 'kind'>, modules: readonly string[] | null): boolean {
  if (plan.kind !== 'pick') return true;
  const need = TASKS_MODULE_NEEDS[key];
  if (!need) return true;
  return need !== 'complete' && cleanModules(modules).includes(need);
}

/** The trial defaults when nothing is stored (PLAN.md §24: 3 users for 10 days). */
export const TRIAL_DEFAULTS = { days: 10, maxUsers: 3 } as const;
