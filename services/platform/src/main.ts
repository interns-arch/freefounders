import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/exception.filter';

export const API_PREFIX = 'api/platform';
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  // Mounted at /api/platform on the shared origin, so the gateway forwards paths unchanged.
  app.setGlobalPrefix(API_PREFIX);
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
    if (MUTATING.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
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
