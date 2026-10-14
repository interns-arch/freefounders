import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import type { Caller } from '../common/http';
import type { AppKey, PlatformRole } from '../db/schema';
import { KeysService } from './keys.service';

export const ISSUER = 'freefounders-platform';
export const AUDIENCE = 'freefounders';
export const ACCESS_TTL_SECONDS = 15 * 60;
const SERVICE_TTL_SECONDS = 60;
/** An unknown `kid` makes us re-read the keys at most this often (a key made by another Platform process). */
const REFETCH_MS = 10_000;

/** Signs and verifies Platform JWTs (EdDSA / Ed25519). */
@Injectable()
export class TokensService {
  private refetchedAt = 0;

  constructor(private readonly keys: KeysService) {}

  /**
   * Access token read by Tasks and Assets. `apps` maps each app the person may open to their user id inside it.
   * Claims: sub = person id, cid = company id, name, role (platform role), apps, fam (refresh session family), and
   * ro = true while the company's subscription is read-only (PLAN.md §21).
   */
  async signAccess(caller: Caller): Promise<string> {
    const key = await this.keys.signingKey();
    return new SignJWT({ cid: caller.companyId, name: caller.name, role: caller.role, apps: caller.apps, fam: caller.sessionFamily, ...(caller.readOnly ? { ro: true } : {}) })
      .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'JWT' })
      .setSubject(caller.personId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .setJti(randomBytes(9).toString('base64url'))
      .sign(key.privateKey);
  }

  async verifyAccess(token: string): Promise<Caller | null> {
    // Only our own signature scheme and our own user tokens: service tokens (audience `<app>-internal`) are refused.
    const options = { issuer: ISSUER, audience: AUDIENCE, algorithms: ['EdDSA'], typ: 'JWT', maxTokenAge: `${ACCESS_TTL_SECONDS + 60}s` };
    try {
      let verified;
      try {
        verified = await jwtVerify(token, await this.keys.verifier(), options);
      } catch (err) {
        if (!(err instanceof errors.JWKSNoMatchingKey) || Date.now() - this.refetchedAt < REFETCH_MS) throw err;
        this.refetchedAt = Date.now();
        verified = await jwtVerify(token, await this.keys.verifier(true), options);
      }
      const { payload } = verified;
      if (typeof payload.sub !== 'string' || typeof payload.cid !== 'string') return null;
      return {
        personId: payload.sub,
        companyId: payload.cid,
        name: String(payload.name ?? ''),
        role: payload.role as PlatformRole,
        apps: (payload.apps ?? {}) as Partial<Record<AppKey, string>>,
        sessionFamily: typeof payload.fam === 'string' ? payload.fam : undefined,
        readOnly: payload.ro === true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Short-lived token the Platform uses to call an app's internal API (audience `<app>-internal`). `cid` names
   * the company the call is for; in multi-company mode the app runs it inside that company's data.
   */
  async signService(app: AppKey, companyId?: string): Promise<string> {
    const key = await this.keys.signingKey();
    return new SignJWT(companyId ? { cid: companyId } : {})
      .setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'JWT' })
      .setSubject('platform')
      .setIssuer(ISSUER)
      .setAudience(`${app}-internal`)
      .setIssuedAt()
      .setExpirationTime(`${SERVICE_TTL_SECONDS}s`)
      .setJti(randomBytes(9).toString('base64url'))
      .sign(key.privateKey);
  }
}
