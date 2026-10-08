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

export interface CataloguePermission {
  key: string;
  label: string;
  group: string;
  /** Allowed scopes, or null for a yes/no permission. */
  scopes: string[] | null;
  /** Only the locked Super Admin role gets it by default (e.g. deleting admins' work). */
  superAdminOnly?: boolean;
}
export interface AppCatalogue {
  app: string;
  scopes: string[];
  permissions: CataloguePermission[];
}
export interface AppAccessExport {
  version: number;
  roles: Array<{ code: string; name: string; description?: string | null; level?: number; archived?: boolean; grants: Array<{ permission: string; scope?: string | null }> }>;
  people: Array<{ personId: string; roles: string[] }>;
}
