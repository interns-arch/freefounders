// FreeFounders Platform sign-in: verifies the Platform's EdDSA (Ed25519) tokens against its published keys.
// Off unless PLATFORM_JWKS_URL (or PLATFORM_JWKS, the key set inline as JSON) is set.
import { createLocalJWKSet, createRemoteJWKSet, decodeProtectedHeader, type JWTPayload, jwtVerify } from 'jose';

export const PLATFORM_ISSUER = 'freefounders-platform';
export const ACCESS_AUDIENCE = 'freefounders';
export const SERVICE_AUDIENCE = 'assets-internal';

type KeySet = ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet>;
let cached: { source: string; keys: KeySet } | undefined;

export function platformEnabled(): boolean {
  return Boolean(process.env.PLATFORM_JWKS?.trim() || process.env.PLATFORM_JWKS_URL?.trim());
}

function keySet(): KeySet {
  const inline = process.env.PLATFORM_JWKS?.trim();
  const source = inline || process.env.PLATFORM_JWKS_URL!.trim();
  if (cached?.source !== source) {
    // Remote keys are cached; an unknown key id (after a rotation) triggers a refetch.
    const keys = inline ? createLocalJWKSet(JSON.parse(inline)) : createRemoteJWKSet(new URL(source), { cacheMaxAge: 10 * 60_000, timeoutDuration: 5000 });
    cached = { source, keys };
  }
  return cached.keys;
}

/** Platform tokens are EdDSA; anything else (e.g. no token) is not ours. */
export function isPlatformToken(token: string): boolean {
  try {
    return decodeProtectedHeader(token).alg === 'EdDSA';
  } catch {
    return false;
  }
}

/** Verified claims, or null when the token is invalid, expired, or meant for someone else. */
export async function verifyPlatformToken(token: string, audience: string): Promise<JWTPayload | null> {
  if (!platformEnabled() || !isPlatformToken(token)) return null;
  try {
    const { payload } = await jwtVerify(token, keySet(), {
      issuer: PLATFORM_ISSUER,
      audience,
      algorithms: ['EdDSA'],
      clockTolerance: 30,
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    return payload;
  } catch {
    return null;
  }
}

export function bearerToken(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice(7).trim() || undefined : undefined;
}
