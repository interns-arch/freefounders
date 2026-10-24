import { Controller, Get, Module } from '@nestjs/common';
import { asc, sql } from 'drizzle-orm';
import { Public } from './common/http';
import { CoreModule } from './core/core.module';
import { ProfileService } from './core/profile.service';
import { PlatformFlowsModule } from './modules/auth/platform-flows.module';
import { DbService } from './db/db.service';
import { tenancyEnabled } from './db/tenancy';
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
    return { status: 'ok', time: new Date().toISOString(), version: process.env.APP_VERSION || null };
  }
}

@Controller('config')
export class ConfigController {
  constructor(
    private readonly dbs: DbService,
    private readonly profile: ProfileService,
  ) {}

  /**
   * Public app settings: the address printed into QR codes, the company shown on screens, and (Kaampilot) the
   * company's brand and which modules are on. No company is known before sign-in in multi-company mode.
   */
  @Public()
  @Get()
  async config() {
    const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, '') || null;
    if (tenancyEnabled() && !this.dbs.companySchema) return { publicUrl, companyName: null, brand: null, modules: null };
    const [company] = await this.dbs.db.select({ name: companies.name }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
    const profile = await this.profile.get();
    const brand = profile?.name ? { shortName: profile.shortName, colour: profile.colour, logoUrl: profile.logoUrl } : null;
    return { publicUrl, companyName: profile?.name || company?.name || null, brand, modules: await this.profile.modules() };
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
    PlatformFlowsModule,
  ],
  controllers: [HealthController, ConfigController],
})
export class AppModule {}
