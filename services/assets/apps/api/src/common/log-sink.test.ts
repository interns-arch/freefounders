// Production log reporter (common/log-sink.ts): off without PLATFORM_LOG_URL, redacts, folds, never slows a request.
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, describe, test } from 'node:test';
import { Controller, Get, HttpException, type INestApplication, Module, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request } from 'express';
import { AllExceptionsFilter } from './exception.filter';
import { cleanPath, flushLogSink, redact, ReportingLogger, reportLog, resetLogSinkForTests } from './log-sink';

const SECRET =
  'bad thing password=hunter2 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl auth Bearer abc123 ' +
  'mail ravi.kumar@example.com phone 9876543210 line 42';
const COMPANY = '11111111-2222-3333-4444-555555555555';

@Controller('t')
class BoomController {
  @Get('boom')
  boom(@Req() req: Request): never {
    Object.assign(req, { companyId: COMPANY, actor: { userId: 'u-1' } });
    throw new TypeError(SECRET);
  }

  @Get('teapot')
  teapot(): never {
    throw new HttpException('nope', 418);
  }
}

@Module({ controllers: [BoomController] })
class BoomModule {}

interface Post {
  headers: IncomingHttpHeaders;
  body: { service: string; version: string | null; entries: Record<string, unknown>[] };
}

let sink: Server;
let sinkUrl = '';
const posts: Post[] = [];
let app: INestApplication;
let base = '';
const saved = { url: process.env.PLATFORM_LOG_URL, token: process.env.LOG_SINK_TOKEN, version: process.env.APP_VERSION };

function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const entries = () => posts.flatMap((p) => p.body.entries);

before(async () => {
  sink = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      posts.push({ headers: req.headers, body: JSON.parse(data) });
      res.writeHead(202).end();
    });
  });
  await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r));
  sinkUrl = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/internal/logs`;

  app = await NestFactory.create(BoomModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  await new Promise<void>((r) => sink.close(() => r()));
  for (const [k, v] of [
    ['PLATFORM_LOG_URL', saved.url],
    ['LOG_SINK_TOKEN', saved.token],
    ['APP_VERSION', saved.version],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

afterEach(() => {
  posts.length = 0;
  resetLogSinkForTests();
  delete process.env.PLATFORM_LOG_URL;
  delete process.env.LOG_SINK_TOKEN;
  delete process.env.APP_VERSION;
});

describe('log sink', () => {
  test('redaction rules', () => {
    const out = redact(SECRET);
    for (const leaked of ['hunter2', 'eyJhbGci', 'abc123', 'ravi.kumar', '9876543210']) assert.ok(!out.includes(leaked), leaked);
    for (const kept of ['password=[hidden]', '[jwt]', 'Bearer [hidden]', 'r***@example.com', '[digits]', 'line 42']) {
      assert.ok(out.includes(kept), kept);
    }
    assert.equal(redact('OTP=4821'), 'OTP=[hidden]');
    assert.equal(redact("failed query\nparams: 'a', 'b'\nnext"), 'failed query\nparams: [hidden]\nnext');
    assert.equal(redact('x 1234567 y 12345'), 'x [digits] y 12345');
    assert.equal(cleanPath('/api/x?code=123456'), '/api/x');
  });

  test('off without PLATFORM_LOG_URL', async () => {
    assert.equal(reportLog({ message: 'x' }), false);
    const res = await fetch(`${base}/t/boom`);
    assert.equal(res.status, 500);
    await flushLogSink();
    assert.equal(posts.length, 0);
  });

  test('an unknown error in a request: 500 body unchanged, one redacted entry with context', async () => {
    process.env.PLATFORM_LOG_URL = sinkUrl;
    process.env.LOG_SINK_TOKEN = 'sink-secret';
    process.env.APP_VERSION = '1.2.3';
    const res = await fetch(`${base}/t/boom?token=abc&x=1`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { statusCode: 500, message: 'Something went wrong. Please try again.' });
    const teapot = await fetch(`${base}/t/teapot`);
    assert.equal(teapot.status, 418);
    await flushLogSink();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].headers['x-log-sink-token'], 'sink-secret');
    assert.equal(posts[0].body.service, 'assets');
    assert.equal(posts[0].body.version, '1.2.3');
    const [entry] = posts[0].body.entries;
    assert.equal(posts[0].body.entries.length, 1);
    assert.equal(entry.level, 'error');
    assert.equal(entry.kind, 'exception');
    assert.equal(entry.event, 'request.failed');
    assert.equal(entry.method, 'GET');
    assert.equal(entry.path, '/t/boom');
    assert.equal(entry.status, 500);
    assert.equal(entry.companyId, COMPANY);
    assert.equal(entry.userId, 'u-1');
    assert.equal(entry.count, 1);
    const message = entry.message as string;
    const stack = entry.stack as string;
    assert.ok(message.startsWith('TypeError: bad thing'), message);
    for (const leaked of ['hunter2', 'eyJhbGci', 'abc123', 'ravi.kumar', '9876543210']) {
      assert.ok(!message.includes(leaked) && !stack.includes(leaked), leaked);
    }
    assert.ok(message.includes('password=[hidden]') && message.includes('Bearer [hidden]'));
    assert.ok(stack.length <= 4000);
  });

  test('sink down: the request still answers 500 quickly', async () => {
    process.env.PLATFORM_LOG_URL = `http://127.0.0.1:${await closedPort()}/internal/logs`;
    const started = Date.now();
    const res = await fetch(`${base}/t/boom`);
    assert.equal(res.status, 500);
    assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
    await flushLogSink(); // fails silently
    assert.equal((await fetch(`${base}/t/boom`)).status, 500);
  });

  test('rate limit and folding', async () => {
    process.env.PLATFORM_LOG_URL = sinkUrl;
    for (let i = 0; i < 5; i++) reportLog({ message: 'same thing', path: '/x?secret=1' });
    for (let i = 0; i < 70; i++) reportLog({ message: `distinct ${i}` });
    await flushLogSink();
    const all = entries();
    assert.equal(all.length, 60); // 1 folded + 59 distinct
    const folded = all.filter((e) => e.message === 'same thing');
    assert.equal(folded.length, 1);
    assert.equal(folded[0].count, 5);
    assert.equal(folded[0].path, '/x');
    assert.ok(posts.every((p) => p.body.entries.length <= 50));
  });

  test('ReportingLogger reports error() lines but not the HTTP context', async () => {
    process.env.PLATFORM_LOG_URL = sinkUrl;
    const logger = new ReportingLogger({ logLevels: [] });
    logger.error('from the filter', 'HTTP');
    logger.error('job crashed secret=xyz', 'Error: job crashed\n    at x (y.js:1:2)', 'Scheduler');
    await flushLogSink();
    const all = entries();
    assert.equal(all.length, 1);
    assert.equal(all[0].message, 'job crashed secret=[hidden]');
    assert.equal(all[0].event, 'nest.Scheduler');
    assert.equal(all[0].kind, 'exception');
  });
});
