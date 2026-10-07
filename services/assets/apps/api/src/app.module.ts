import { Controller, Get, Module } from '@nestjs/common';
import { asc, sql } from 'drizzle-orm';
import { Public } from './common/http';
import { CoreModule } from './core/core.module';
import { DbService } from './db/db.service';
import { companies } from './db/schema';
import { AdminModule } from './modules/admin/admin.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { ExitModule } from './modules/exit/exit.module';
import { InsightsModule } from './modules/insights/insights.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { OrgModule } from './modules/org/org.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { ServiceModule } from './modules/service/service.module';

@Controller('health')
export class HealthController {
  constructor(private readonly dbs: DbService) {}

  @Public()
  @Get()
  async health() {
    await this.dbs.db.execute(sql`select 1`);
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Controller('config')
export class ConfigController {
  constructor(private readonly dbs: DbService) {}

  /** Public app settings: the address printed into QR codes and the company shown on screens. */
  @Public()
  @Get()
  async config() {
    const [company] = await this.dbs.db.select({ name: companies.name }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
    return { publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, '') || null, companyName: company?.name ?? null };
  }
}

@Module({
  imports: [
    CoreModule,
    AuthModule,
    OrgModule,
    CatalogModule,
    AssetsModule,
    ExitModule,
    EmployeesModule,
    ServiceModule,
    InsightsModule,
    AdminModule,
    ReconciliationModule,
    OnboardingModule,
  ],
  controllers: [HealthController, ConfigController],
})
export class AppModule {}
