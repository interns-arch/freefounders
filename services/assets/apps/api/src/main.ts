import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/exception.filter';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? ['error'] : ['warn', 'error'],
  });
  app.setGlobalPrefix('api');
  // Behind a hosting proxy (Render) the client address and https come from X-Forwarded-*.
  app.set('trust proxy', process.env.RENDER || process.env.TRUST_PROXY === 'true' ? 1 : 'loopback');
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'", 'blob:'],
          // HTTPS is enforced by the reverse proxy; upgrading here breaks plain-HTTP LAN installs.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '4mb' });

  // CSRF defence: browsers cannot send this custom header cross-site without a CORS preflight,
  // and the session cookie is SameSite=Lax.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (MUTATING.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      res.status(403).json({ statusCode: 403, message: 'Missing request header' });
      return;
    }
    next();
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // In production the API also serves the built web app (single origin, no CORS).
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (existsSync(path.join(webDist, 'index.html'))) {
    // redirect: false — "/assets" is an app route, not the build's assets/ folder.
    // Hashed build files never change; everything else (the page itself, the icon) is re-checked so updates show up.
    app.useStaticAssets(webDist, {
      index: false,
      redirect: false,
      setHeaders: (res, file) => res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`✔ API ready on http://localhost:${port}/api`);
}

if (require.main === module) {
  void bootstrap();
}
