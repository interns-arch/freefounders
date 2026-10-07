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
}

/** Base URL of each app's internal API, e.g. http://localhost:8000/api/internal. */
export function internalUrl(app: AppKey): string | undefined {
  const url = process.env[`${app.toUpperCase()}_INTERNAL_URL`]?.trim();
  return url ? url.replace(/\/+$/, '') : undefined;
}

/** Calls an app's `POST /internal/provision` with a short-lived service token; the app finds or creates the user. */
@Injectable()
export class ProvisionClient {
  constructor(private readonly tokens: TokensService) {}

  async provision(app: AppKey, input: ProvisionInput): Promise<string> {
    const base = internalUrl(app);
    if (!base) throw new BadGatewayException(`${app} is not connected (${app.toUpperCase()}_INTERNAL_URL is not set)`);
    let res: Response;
    try {
      res = await fetch(`${base}/provision`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.tokens.signService(app)}`,
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
}
