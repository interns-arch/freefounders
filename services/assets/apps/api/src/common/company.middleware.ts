// Multi-company mode (TENANCY=schemas): pins every API request to its company's schema (PLAN.md §14).
// The company comes from the Platform access token (`cid`), the Platform service token for /api/internal/*,
// or the company prefix of the session cookie (so <img> requests for photos work). API calls without a
// company are refused with 401, including the app's own password login: people sign in through the Platform.
import type { NextFunction, Request, Response } from 'express';
import type { DbService } from '../db/db.service';
import { schemaFor, tenancyEnabled } from '../db/tenancy';
import { ACCESS_AUDIENCE, bearerToken, SERVICE_AUDIENCE, verifyPlatformToken } from '../modules/auth/platform-token';
import type { AuthedRequest } from './http';

export const SESSION_COMPANY_SEPARATOR = '~';

/** Paths that never touch a company's data. */
const NO_COMPANY_PATHS = ['/api/health', '/api/internal/companies'];
/** Paths that work with or without a company. */
const OPTIONAL_COMPANY_PATHS = ['/api/config'];

/** Session cookie value in multi-company mode: `<companyId>~<token>`; plain token otherwise. */
export function sessionCookieValue(token: string, companyId: string | undefined): string {
  return companyId ? `${companyId}${SESSION_COMPANY_SEPARATOR}${token}` : token;
}

/** The session token and (multi-company mode) the company it belongs to. */
export function parseSessionCookie(value: string): { token: string; companyId?: string } {
  const at = value.indexOf(SESSION_COMPANY_SEPARATOR);
  return at < 0 ? { token: value } : { companyId: value.slice(0, at), token: value.slice(at + 1) };
}

async function companyIdOf(req: Request, fullPath: string): Promise<string | undefined> {
  const bearer = bearerToken(req.headers.authorization);
  if (bearer) {
    const audience = fullPath.startsWith('/api/internal/') ? SERVICE_AUDIENCE : ACCESS_AUDIENCE;
    const claims = await verifyPlatformToken(bearer, audience);
    if (claims && typeof claims.cid === 'string') return claims.cid;
  }
  const cookie = (req as AuthedRequest).cookies?.eam_session;
  if (typeof cookie === 'string') return parseSessionCookie(cookie).companyId;
  return undefined;
}

export function companyMiddleware(dbs: DbService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Mounted on /api, so Express has stripped that prefix from req.path.
    const fullPath = req.baseUrl + req.path;
    if (!tenancyEnabled() || NO_COMPANY_PATHS.some((p) => fullPath.startsWith(p))) return next();
    try {
      const companyId = await companyIdOf(req, fullPath);
      const schema = await schemaFor(dbs.pool, companyId);
      if (!schema) {
        if (OPTIONAL_COMPANY_PATHS.some((p) => fullPath.startsWith(p))) return next();
        res.status(401).json({
          statusCode: 401,
          code: 'no_company',
          message: companyId ? 'This company is not set up in Assets' : 'Sign in through Kaampilot',
        });
        return;
      }
      (req as AuthedRequest).companyId = companyId;
      const release = await dbs.bindCompany(schema, next);
      // The browser may have gone away while this request waited for a connection: 'close' then fired before we
      // listened, and the pinned connection would never return to the pool (Assets froze twice with all of them
      // held, 2026-10-28/29). Release now in that case; otherwise when the response closes or finishes.
      // (Not req.destroyed: an incoming request is destroyed once its body has been read, which is normal.)
      if (res.closed || res.writableFinished) release();
      else {
        res.once('close', release);
        res.once('finish', release);
      }
    } catch (err) {
      next(err);
    }
  };
}
