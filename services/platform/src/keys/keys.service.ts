import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createPrivateKey, generateKeyPairSync, type KeyObject, randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { exportJWK, type JWK } from 'jose';
import { DbService } from '../db/db.service';
import { signingKeys } from '../db/schema';

const DEV_SECRET = 'dev-only-platform-secret-change-me';

/** PLATFORM_SECRET encrypts the private signing keys at rest. Required in production. */
export function platformSecret(): string {
  const secret = process.env.PLATFORM_SECRET?.trim();
  if (secret) {
    if (secret.length < 32) throw new Error('PLATFORM_SECRET must be at least 32 characters');
    return secret;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('PLATFORM_SECRET is required in production');
  return DEV_SECRET;
}

function cipherKey(): Buffer {
  return createHash('sha256').update(platformSecret()).digest();
}

function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1') throw new Error('Unknown key format');
  const decipher = createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
}

/** Ed25519 signing keys: created on first start, private half encrypted in the database, public half published as JWKS. */
@Injectable()
export class KeysService implements OnModuleInit {
  private active?: SigningKey;
  private published?: { keys: JWK[] };

  constructor(private readonly dbs: DbService) {}

  async onModuleInit() {
    platformSecret(); // fail fast on a bad/missing secret
  }

  async signingKey(): Promise<SigningKey> {
    if (this.active) return this.active;
    const [row] = await this.dbs.db.select().from(signingKeys).where(eq(signingKeys.active, true)).orderBy(desc(signingKeys.createdAt)).limit(1);
    if (row) {
      this.active = { kid: row.kid, privateKey: createPrivateKey(open(row.privateEnc)) };
      return this.active;
    }
    return this.rotate();
  }

  /** Creates a new active key. Older keys stay published so tokens they signed still verify until they expire. */
  async rotate(): Promise<SigningKey> {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const kid = randomBytes(8).toString('hex');
    const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'EdDSA', use: 'sig' };
    await this.dbs.tx(async (tx) => {
      await tx.update(signingKeys).set({ active: false }).where(eq(signingKeys.active, true));
      await tx.insert(signingKeys).values({ kid, publicJwk: jwk, privateEnc: seal(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string) });
    });
    new Logger('Keys').log(`New signing key ${kid}`);
    this.active = { kid, privateKey };
    this.published = undefined;
    return this.active;
  }

  /** Public keys for /.well-known/jwks.json (newest first, at most 3). */
  async jwks(): Promise<{ keys: JWK[] }> {
    if (this.published) return this.published;
    await this.signingKey();
    const rows = await this.dbs.db.select({ jwk: signingKeys.publicJwk }).from(signingKeys).orderBy(desc(signingKeys.createdAt)).limit(3);
    this.published = { keys: rows.map((r) => r.jwk as JWK) };
    return this.published;
  }
}
