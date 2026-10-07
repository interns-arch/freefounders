import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { appSettings } from '../db/schema';

/** Encrypts saved passwords (AES-256-GCM) so admins can look them up. Key: CREDENTIAL_KEY, else one kept in app_settings. */
@Injectable()
export class CredentialVault {
  private key: Promise<Buffer> | null = null;

  constructor(private readonly dbs: DbService) {}

  private loadKey(): Promise<Buffer> {
    this.key ??= (async () => {
      if (process.env.CREDENTIAL_KEY) return createHash('sha256').update(process.env.CREDENTIAL_KEY).digest();
      await this.dbs.root.insert(appSettings).values({ key: 'credential_key', value: randomBytes(32).toString('hex') }).onConflictDoNothing();
      const [row] = await this.dbs.root.select().from(appSettings).where(eq(appSettings.key, 'credential_key'));
      return Buffer.from(row.value, 'hex');
    })().catch((err) => {
      this.key = null;
      throw err;
    });
    return this.key;
  }

  async seal(password: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.loadKey(), iv);
    const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  }

  async open(sealed: string | null): Promise<string | null> {
    if (!sealed) return null;
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1') return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', await this.loadKey(), Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
