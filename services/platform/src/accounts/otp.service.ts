import { BadRequestException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service';
import { authTickets, otpCodes } from '../db/schema';
import type { Identifier } from './identifier';

export type OtpPurpose = 'signup' | 'reset' | 'login';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** Codes per identifier in 15 minutes, and the gap between two of them. */
const PER_TARGET = 5;
const RESEND_GAP_MS = 30 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

/** Codes one IP address may ask for in 15 minutes (OTP_IP_LIMIT, default 20; 0 = off). */
function ipLimit(): number {
  const n = Number(process.env.OTP_IP_LIMIT ?? 20);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
}

/** The code comes back in the answer (dev and tests only: OTP_DEV_ECHO=1, never in production). */
export function otpDevEcho(): boolean {
  return process.env.OTP_DEV_ECHO === '1' && process.env.NODE_ENV !== 'production';
}

/** Sends a one-time code by email or SMS. The real senders (SES, a DLT SMS template / WhatsApp) come with §20 step 0. */
export interface OtpSender {
  send(target: Identifier, code: string, purpose: OtpPurpose): Promise<void>;
}
export const OTP_SENDER = 'OTP_SENDER';

/** Writes the code to the Platform log. Nothing leaves the machine. */
export class FakeOtpSender implements OtpSender {
  private readonly log = new Logger('OTP');
  async send(target: Identifier, code: string, purpose: OtpPurpose) {
    this.log.log(`OTP for ${target.value}: ${code} (${purpose})`);
  }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const codeHash = (otpId: string, code: string) => sha256(`${otpId}:${code}`);
/** 429 with the seconds until a new code can be asked for (the web shows a live countdown). */
const tooMany = (message: string, retryAfterSeconds: number) =>
  new HttpException({ statusCode: 429, message, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) }, 429);
const waitText = (s: number) => (s <= 90 ? `${Math.max(1, Math.ceil(s))} seconds` : `${Math.ceil(s / 60)} minutes`);

@Injectable()
export class OtpService {
  constructor(
    private readonly dbs: DbService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  /** Sends a 6-digit code (10 minutes, 5 tries). Limited per identifier and per IP address. */
  async start(target: Identifier, purpose: OtpPurpose, ip?: string): Promise<{ otpId: string; channel: 'email' | 'sms'; devCode?: string }> {
    const db = this.dbs.db;
    const since = new Date(Date.now() - WINDOW_MS);
    const [byTarget] = await db
      .select({ n: sql<number>`count(*)::int`, first: sql<Date | null>`min(${otpCodes.createdAt})`, last: sql<Date | null>`max(${otpCodes.createdAt})` })
      .from(otpCodes)
      .where(and(eq(otpCodes.target, target.value), gt(otpCodes.createdAt, since)));
    if ((byTarget?.n ?? 0) >= PER_TARGET) {
      const wait = byTarget?.first ? (new Date(byTarget.first).getTime() + WINDOW_MS - Date.now()) / 1000 : WINDOW_MS / 1000;
      throw tooMany(`Too many codes asked for. You can ask for a new one in ${waitText(wait)}.`, wait);
    }
    const last = byTarget?.last ? new Date(byTarget.last) : null;
    if (last && Date.now() - last.getTime() < RESEND_GAP_MS) {
      const wait = (last.getTime() + RESEND_GAP_MS - Date.now()) / 1000;
      throw tooMany(`A code was just sent. You can ask for a new one in ${waitText(wait)}.`, wait);
    }
    const limit = ipLimit();
    // Dev only (OTP_DEV_ECHO=1, never in production): everything typed on this machine reaches the Platform from the
    // same loopback address through the dev gateway, so the per-network guard would stop the browser tests.
    const devLoopback = otpDevEcho() && !!ip && /^(::1|127\.|::ffff:127\.)/.test(ip);
    if (limit && ip && !devLoopback) {
      const [byIp] = await db
        .select({ n: sql<number>`count(*)::int`, first: sql<Date | null>`min(${otpCodes.createdAt})` })
        .from(otpCodes)
        .where(and(eq(otpCodes.ip, ip), gt(otpCodes.createdAt, since)));
      if ((byIp?.n ?? 0) >= limit) {
        const wait = byIp?.first ? (new Date(byIp.first).getTime() + WINDOW_MS - Date.now()) / 1000 : WINDOW_MS / 1000;
        throw tooMany(`Too many codes asked for from your network. Try again in ${waitText(wait)}.`, wait);
      }
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    await db.insert(otpCodes).values({ id, target: target.value, channel: target.channel, purpose, codeHash: codeHash(id, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), ip: ip ?? null });
    await this.sender.send(target, code, purpose);
    return { otpId: id, channel: target.channel, ...(otpDevEcho() ? { devCode: code } : {}) };
  }

  /**
   * Checks a code. One try is claimed atomically before comparing, so parallel guesses cannot exceed 5. A right code
   * is used up, unless `consume: false` (forgot password checks the code on its own step, then sends it again with the
   * new password): then the right code gives its try back. Returns the identifier the code was sent to.
   */
  async verify(otpId: string, code: string, purpose: OtpPurpose, opts: { consume?: boolean } = {}): Promise<{ target: string; channel: string }> {
    const db = this.dbs.db;
    if (!/^[0-9a-f-]{36}$/i.test(otpId)) throw new BadRequestException({ message: 'This code has expired. Ask for a new one.', errors: { code: 'Expired' } });
    const [claim] = await db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(and(eq(otpCodes.id, otpId), eq(otpCodes.purpose, purpose), isNull(otpCodes.usedAt), gt(otpCodes.expiresAt, sql`now()`), lt(otpCodes.attempts, OTP_MAX_ATTEMPTS)))
      .returning();
    if (!claim) throw new BadRequestException({ message: 'This code has expired or was tried too many times. Ask for a new one.', errors: { code: 'Expired' } });
    const want = Buffer.from(claim.codeHash, 'hex');
    const got = Buffer.from(codeHash(claim.id, String(code).trim()), 'hex');
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      const left = OTP_MAX_ATTEMPTS - claim.attempts;
      throw new BadRequestException({ message: left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code. Ask for a new one.', errors: { code: 'Wrong code' } });
    }
    if (opts.consume === false) {
      await db.update(otpCodes).set({ attempts: sql`greatest(${otpCodes.attempts} - 1, 0)` }).where(eq(otpCodes.id, claim.id));
      return { target: claim.target, channel: claim.channel };
    }
    const [used] = await db.update(otpCodes).set({ usedAt: new Date() }).where(and(eq(otpCodes.id, claim.id), isNull(otpCodes.usedAt))).returning({ id: otpCodes.id });
    if (!used) throw new BadRequestException({ message: 'This code was already used. Ask for a new one.', errors: { code: 'Used' } });
    return { target: claim.target, channel: claim.channel };
  }
}

/** Short-lived single-use proofs (sign-up token, choose-company ticket). Only their sha256 is stored. */
@Injectable()
export class TicketsService {
  constructor(private readonly dbs: DbService) {}

  async create(kind: 'signup' | 'login', ttlMs: number, data: { target?: string; channel?: string; accountId?: string }): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.dbs.db.insert(authTickets).values({ id: sha256(token), kind, target: data.target ?? null, channel: data.channel ?? null, accountId: data.accountId ?? null, expiresAt: new Date(Date.now() + ttlMs) });
    return token;
  }

  /** A live ticket of this kind, or null. */
  async peek(token: string | undefined, kind: 'signup' | 'login') {
    if (!token || token.length < 20 || token.length > 200) return null;
    const [row] = await this.dbs.db
      .select()
      .from(authTickets)
      .where(and(eq(authTickets.id, sha256(token)), eq(authTickets.kind, kind), isNull(authTickets.usedAt), gt(authTickets.expiresAt, sql`now()`)))
      .limit(1);
    return row ?? null;
  }

  /** Uses the ticket up (atomically: only one request wins). */
  async take(token: string, kind: 'signup' | 'login') {
    const [row] = await this.dbs.db
      .update(authTickets)
      .set({ usedAt: new Date() })
      .where(and(eq(authTickets.id, sha256(token)), eq(authTickets.kind, kind), isNull(authTickets.usedAt), gt(authTickets.expiresAt, sql`now()`)))
      .returning();
    return row ?? null;
  }
}
