import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { ReportingLogger } from './console/log-sink';

export const API_PREFIX = 'api/platform';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Payment gateway webhooks (Cashfree: /billing/webhooks/cashfree): signed, never cookie-authenticated.
const WEBHOOK = /^\/billing\/webhooks?\/[a-z]+$/;

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Payment webhooks are signed over the exact bytes received (req.rawBody).
    rawBody: true,
    // error() lines also go to the production log (console/log-sink.ts, PLAN.md §21.9).
    logger: new ReportingLogger({ logLevels: process.env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'] }),
  });
  // Mounted at /api/platform on the shared origin, so the gateway forwards paths unchanged.
  // POST /internal/logs (the apps' log sink) stays outside the prefix: the public gateway never forwards it.
  app.setGlobalPrefix(API_PREFIX, { exclude: [{ path: 'internal/logs', method: RequestMethod.POST }] });
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : 'loopback');
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' }); // room for a 512 KB logo, base64-encoded

  // CSRF defence (same rule as Assets): a custom header cannot be sent cross-site without a CORS preflight,
  // and the refresh cookie is SameSite=Lax.
  app.use(`/${API_PREFIX}`, (req: Request, res: Response, next: NextFunction) => {
    // Answers carry tokens and people's details: never kept by browsers or proxies (the public logo sets its own).
    res.setHeader('Cache-Control', 'no-store');
    // Gateway webhooks carry no cookie or token; their signature is checked instead (billing/gateway.ts).
    if (MUTATING.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest' && !WEBHOOK.test(req.path)) {
      res.status(403).json({ statusCode: 403, message: 'Missing request header' });
      return;
    }
    next();
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`✔ Platform API ready on http://localhost:${port}/${API_PREFIX}`);
}

if (require.main === module) {
  void bootstrap();
}
