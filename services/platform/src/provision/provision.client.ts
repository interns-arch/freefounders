import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import type { AppKey } from '../db/schema';
import { TokensService } from '../keys/tokens.service';

export interface ProvisionInput {
  personId: string;
  fullName: string;
  email: string | null;
  employeeCode: string | null;
  mobile: string | null;
  username: string | null;
  /** App-specific role name/code chosen by the admin; the app applies its default when absent. */
  appRole?: string;
  /** owner / admin / member. When no appRole is given, an app makes owners and admins its own admins. */
  platformRole?: string;
}

/** Base URL of each app's internal API, e.g. http://localhost:8000/api/internal. */
export interface AppModule {
  key: string;
  label: string;
  description: string;
  /** On for a new company unless switched off. */
  default: boolean;
}

export interface AppModules {
  app: AppKey;
  modules: AppModule[];
}

export function internalUrl(app: AppKey): string | undefined {
  const url = process.env[`${app.toUpperCase()}_INTERNAL_URL`]?.trim();
  return url ? url.replace(/\/+$/, '') : undefined;
}

/** Calls an app's `POST /internal/provision` with a short-lived service token; the app finds or creates the user. */
@Injectable()
export class ProvisionClient {
  constructor(private readonly tokens: TokensService) {}

  /** The roles an admin can choose from inside an app, e.g. [{ value: 'warehouse', label: 'Warehouse Team' }]. */
  async roles(app: AppKey, companyId: string): Promise<Array<{ value: string; label: string }>> {
    const base = internalUrl(app);
    if (!base) throw new BadGatewayException(`${app} is not connected (${app.toUpperCase()}_INTERNAL_URL is not set)`);
    try {
      const res = await fetch(`${base}/roles`, {
        headers: { authorization: `Bearer ${await this.tokens.signService(app, companyId)}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as Array<{ value: string; label: string }>;
      return rows.map((r) => ({ value: String(r.value), label: String(r.label ?? r.value) }));
    } catch (err) {
      throw new BadGatewayException(`Could not load ${app} roles: ${(err as Error).message}`);
    }
  }

  async provision(app: AppKey, companyId: string, input: ProvisionInput): Promise<string> {
    const base = internalUrl(app);
    if (!base) throw new BadGatewayException(`${app} is not connected (${app.toUpperCase()}_INTERNAL_URL is not set)`);
    let res: Response;
    try {
      res = await fetch(`${base}/provision`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.tokens.signService(app, companyId)}`,
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new BadGatewayException(`Could not reach ${app}: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as { userId?: string | number; message?: string; detail?: string } | null;
    if (res.ok && body?.userId !== undefined && body.userId !== null) return String(body.userId);
    const reason = body?.message ?? body?.detail ?? `HTTP ${res.status}`;
    // The app rejected the data (e.g. email already used by an unlinked user): show the admin why.
    if (res.status >= 400 && res.status < 500) throw new BadRequestException(`${app}: ${reason}`);
    throw new BadGatewayException(`${app} could not add this person: ${reason}`);
  }

  /**
   * Multi-company mode: asks an app to set up a company (its own schema plus starter data). Idempotent, so it is
   * safe to repeat. Creating a schema runs the app's migrations, which can take a while.
   */
  async setUpCompany(app: AppKey, company: { companyId: string; code: string; name: string }): Promise<{ created: boolean; schema: string }> {
    const base = internalUrl(app);
    if (!base) throw new BadGatewayException(`${app} is not connected (${app.toUpperCase()}_INTERNAL_URL is not set)`);
    let res: Response;
    try {
      res = await fetch(`${base}/companies`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.tokens.signService(app)}`,
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify(company),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      throw new BadGatewayException(`Could not reach ${app}: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as { created?: boolean; schema?: string; message?: string; detail?: string } | null;
    if (res.ok && body?.schema) return { created: Boolean(body.created), schema: body.schema };
    throw new BadGatewayException(`${app} could not set up ${company.name}: ${body?.message ?? body?.detail ?? `HTTP ${res.status}`}`);
  }

  /** The permissions an app offers to the role builder. */
  async permissions(app: AppKey, companyId: string): Promise<AppCatalogue> {
    return this.internalJson<AppCatalogue>(app, 'GET', '/permissions', companyId);
  }

  /** The company's roles inside an app and who holds them (to bring an existing company into the role builder). */
  async exportAccess(app: AppKey, companyId: string): Promise<AppAccessExport> {
    return this.internalJson<AppAccessExport>(app, 'GET', '/access', companyId);
  }

  /** Sends the company's full role set, and the roles of the listed people, to an app. */
  async pushAccess(app: AppKey, companyId: string, body: unknown): Promise<{ applied: boolean; version?: number; missingPeople?: string[]; problems?: string[] }> {
    return this.internalJson(app, 'PUT', '/access', companyId, body);
  }

  /** The modules an app can switch on or off, with their launch defaults. */
  async modules(app: AppKey, companyId: string): Promise<AppModules> {
    return this.internalJson<AppModules>(app, 'GET', '/modules', companyId);
  }

  /** Sends the company's profile (names, colour, logo address, module switches) to an app. */
  async pushCompany(app: AppKey, companyId: string, body: unknown): Promise<{ applied: boolean; version?: number }> {
    return this.internalJson(app, 'PUT', '/company', companyId, body);
  }

  /** An app's departments and each linked person's department / manager (to bring a company into the directory). */
  async exportPeople(app: AppKey, companyId: string): Promise<import('../people/directory.service').AppPeopleExport> {
    return this.internalJson(app, 'GET', '/people', companyId);
  }

  /** Sends the department list and the directory fields of the people who have this app. */
  async pushPeople(app: AppKey, companyId: string, body: unknown): Promise<{ applied: boolean; version?: number }> {
    return this.internalJson(app, 'PUT', '/people', companyId, body);
  }

  /**
   * Permanently deletes a person's records in an app (PLAN.md §19.12): `DELETE /internal/people/<personId>`.
   * `options` (the admin's choices: hand over / keep history…) go as the JSON body; none = delete everything.
   * `{ deleted: false }` means the app never had them. A 400 (the app refused the choices before changing anything) is
   * passed on as a 400 "<App>: …"; anything else other than a 200 (unreachable, 401, 409, 5xx) throws a 502
   * "<App> could not delete their data: …". Either way the caller stops before deleting anything in the Platform.
   */
  /** Tasks only: deletes every user not linked to a Platform person, with their records (`company -- reset`). */
  async deleteUnlinked(companyId: string): Promise<{ deleted: number }> {
    const base = internalUrl('tasks');
    if (!base) throw new BadGatewayException('Tasks is not connected (TASKS_INTERNAL_URL is not set)');
    const res = await fetch(`${base}/unlinked-people`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${await this.tokens.signService('tasks', companyId)}`, 'x-requested-with': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) throw new BadGatewayException(`Tasks could not delete its unlinked users: HTTP ${res.status}`);
    return (await res.json()) as { deleted: number };
  }

  async deletePerson(app: AppKey, companyId: string, personId: string, options?: Record<string, unknown>): Promise<AppDeleteResult> {
    const label = app === 'tasks' ? 'Tasks' : 'Assets';
    const fail = (reason: string) => new BadGatewayException(`${label} could not delete their data: ${reason}`);
    const base = internalUrl(app);
    if (!base) throw fail(`${label} is not connected (${app.toUpperCase()}_INTERNAL_URL is not set)`);
    let res: Response;
    try {
      res = await fetch(`${base}/people/${encodeURIComponent(personId)}`, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${await this.tokens.signService(app, companyId)}`,
          'x-requested-with': 'XMLHttpRequest',
          ...(options ? { 'content-type': 'application/json' } : {}),
        },
        // No body = delete everything (the original contract); with one, the admin's choices for this app.
        body: options ? JSON.stringify(options) : undefined,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw fail(`could not reach it (${(err as Error).message})`);
    }
    const body = (await res.json().catch(() => null)) as
      | { deleted?: boolean; counts?: Record<string, number>; handed_over?: Record<string, number>; anonymised?: boolean; message?: string | string[]; detail?: string }
      | null;
    if (res.status === 200 && body && typeof body.deleted === 'boolean') {
      return { deleted: body.deleted, counts: body.counts, handedOver: body.handed_over, anonymised: body.anonymised };
    }
    const message = (Array.isArray(body?.message) ? body.message.join(' · ') : body?.message) ?? body?.detail ?? `HTTP ${res.status}`;
    // The app refused the choices (e.g. the hand-over person cannot take them) before changing anything.
    if (res.status === 400) throw new BadRequestException(`${label}: ${message}`);
    throw fail(message);
  }

  /** Any internal endpoint of an app, for the cross-app rules (PLAN.md §17.4). */
  async internal<T = unknown>(app: AppKey, method: string, path: string, companyId: string, body?: unknown): Promise<T> {
    return this.internalJson<T>(app, method, path, companyId, body);
  }

  private async internalJson<T>(app: AppKey, method: string, path: string, companyId: string, body?: unknown): Promise<T> {
    const base = internalUrl(app);
    if (!base) throw new BadGatewayException(`${app} is not connected (${app.toUpperCase()}_INTERNAL_URL is not set)`);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await this.tokens.signService(app, companyId)}`,
          'x-requested-with': 'XMLHttpRequest',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new BadGatewayException(`Could not reach ${app}: ${(err as Error).message}`);
    }
    const data = (await res.json().catch(() => null)) as (T & { message?: string; detail?: string }) | null;
    if (!res.ok || data === null) throw new BadGatewayException(`${app}: ${data?.message ?? data?.detail ?? `HTTP ${res.status}`}`);
    return data;
  }
}

/** What an app answers to DELETE /internal/people/<id>. */
export interface AppDeleteResult {
  deleted: boolean;
  counts?: Record<string, number>;
  /** How many open tasks / leads / assets went to the hand-over person. */
  handedOver?: Record<string, number>;
  /** Their kept history now shows as "Deleted user". */
  anonymised?: boolean;
}

/**
 * When an app's catalogue gets a new version, roles saved before it are upgraded once (PLAN.md §19.19): a role that
 * matches a rule gets the permission at the rule's scope (the widest wins). `everyone`: any role with a permission in
 * that app; `from` (+ `fromScopes`): a role that had that permission; `minLevel`: a role at that level or above.
 */
export interface UpgradeRule {
  everyone?: boolean;
  from?: string;
  fromScopes?: string[];
  minLevel?: number;
  scope?: string;
}
export interface CataloguePermission {
  key: string;
  label: string;
  group: string;
  /** One line shown under the permission in the role builder. */
  description?: string;
  /** Allowed scopes, or null for a yes/no permission. */
  scopes: string[] | null;
  /** Only the locked Owner (Super Admin) role gets it by default (e.g. deleting admins' work). */
  superAdminOnly?: boolean;
  /** An old blank scope means this one (a permission that gained scopes). */
  legacyScope?: string;
  upgrade?: UpgradeRule[];
}
export interface AppCatalogue {
  app: string;
  scopes: string[];
  permissions: CataloguePermission[];
  /** Catalogue version (missing = 1). */
  version?: number;
  /** Permissions that no longer exist on their own; the upgrade replaces them. */
  retired?: string[];
}
export interface AppAccessExport {
  version: number;
  roles: Array<{ code: string; name: string; description?: string | null; level?: number; archived?: boolean; grants: Array<{ permission: string; scope?: string | null }> }>;
  people: Array<{ personId: string; roles: string[] }>;
}
