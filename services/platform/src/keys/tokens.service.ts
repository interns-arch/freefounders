import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify, SignJWT } from 'jose';
import type { Caller } from '../common/http';
import type { AppKey, PlatformRole } from '../db/schema';
import { KeysService } from './keys.service';

export const ISSUER = 'freefounders-platform';
export const AUDIENCE = 'freefounders';
export const ACCESS_TTL_SECONDS = 15 * 60;
const SERVICE_TTL_SECONDS = 60;

/** Signs and verifies Platform JWTs (EdDSA / Ed25519). */
@Injectable()
export class TokensService {
  constructor(private readonly keys: KeysService) {}

  /**
   * Access token read by Tasks and Assets. `apps` maps each app the person may open to their user id inside it.
   * Claims: sub = person id, cid = company id, name, role (platform role), apps, fam (refresh session family).
   */
  async signAccess(caller: Caller): Promise<string> {
    const key = await this.keys.signingKey();
    return new SignJWT({ cid: caller.companyId, name: caller.name, role: caller.role, apps: caller.apps, fam: caller.sessionFamily })
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
    try {
      const { payload } = await jwtVerify(token, createLocalJWKSet(await this.keys.jwks()), {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['EdDSA'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.cid !== 'string') return null;
      return {
        personId: payload.sub,
        companyId: payload.cid,
        name: String(payload.name ?? ''),
        role: payload.role as PlatformRole,
        apps: (payload.apps ?? {}) as Partial<Record<AppKey, string>>,
        sessionFamily: typeof payload.fam === 'string' ? payload.fam : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Short-lived token the Platform uses to call an app's internal API (audience `<app>-internal`). */
  async signService(app: AppKey): Promise<string> {
    const key = await this.keys.signingKey();
    return new SignJWT({})
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
