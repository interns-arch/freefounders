// Multi-company requests give their pinned connection back even when the browser left while they waited for one
// (Assets froze twice with every pool connection held, 2026-10-28/29). No database: the DbService is a stand-in.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, before, describe, test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import type { DbService } from '../db/db.service';
import { companyMiddleware } from './company.middleware';

const COMPANY = '11111111-2222-3333-4444-555555555555';
let saved: string | undefined;

function stand(): { dbs: DbService; released: () => number } {
  let releases = 0;
  const dbs = {
    pool: { query: async () => ({ rows: [{ schema_name: 'co_test' }] }) },
    bindCompany: async (_schema: string, fn: () => void) => {
      fn();
      return () => {
        releases += 1;
      };
    },
  } as unknown as DbService;
  return { dbs, released: () => releases };
}

function request(): Request {
  return { baseUrl: '/api', path: '/assets', headers: {}, cookies: { eam_session: `${COMPANY}~token` }, destroyed: false } as unknown as Request;
}

function response(state: { closed?: boolean }): Response & EventEmitter {
  return Object.assign(new EventEmitter(), { closed: false, writableFinished: false, ...state, status() { return this; }, json() { return this; } }) as unknown as Response & EventEmitter;
}

describe('company middleware connection release', () => {
  before(() => {
    saved = process.env.TENANCY;
    process.env.TENANCY = 'schemas';
  });
  after(() => {
    if (saved === undefined) delete process.env.TENANCY;
    else process.env.TENANCY = saved;
  });

  test('a response already closed while waiting releases the connection at once', async () => {
    const { dbs, released } = stand();
    await companyMiddleware(dbs)(request(), response({ closed: true }), (() => {}) as NextFunction);
    assert.equal(released(), 1);
  });

  test('an open response keeps the connection until it finishes or closes', async () => {
    const { dbs, released } = stand();
    const res = response({});
    await companyMiddleware(dbs)(request(), res, (() => {}) as NextFunction);
    assert.equal(released(), 0, 'still in use while the response is open');
    res.emit('finish');
    res.emit('close');
    assert.ok(released() >= 1);
  });
});
