import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { companyMiddleware } from './common/company.middleware';
import { AllExceptionsFilter } from './common/exception.filter';
import { ExportInterceptor } from './common/export';
import { ReportingLogger } from './common/log-sink';
import { DbService } from './db/db.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function createApp() {
  const logLevels: ('warn' | 'error')[] = process.env.NODE_ENV === 'test' ? ['error'] : ['warn', 'error'];
  // ReportingLogger also sends error() lines to the Platform's production log when PLATFORM_LOG_URL is set.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ReportingLogger({ logLevels }),
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
  // Multi-company mode only (TENANCY=schemas): every API request runs in its company's schema.
  app.use('/api', companyMiddleware(app.get(DbService)));
  app.useGlobalFilters(new AllExceptionsFilter());
  // ?export=xlsx|csv on the list routes marked @Exportable (PLAN.md §19.31)
  app.useGlobalInterceptors(new ExportInterceptor(app.get(Reflector)));
  app.enableShutdownHooks();

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
