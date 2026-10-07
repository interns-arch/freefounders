import { Controller, Get, Param } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { APP_INFO } from '../auth/auth.service';
import { AdminOnly, type Caller, CurrentCaller, notFound } from '../common/http';
import { DbService } from '../db/db.service';
import { type AppKey, APPS, companies } from '../db/schema';
import { ProvisionClient } from '../provision/provision.client';

/** What the people-admin screen needs to know about the company's apps. */
@AdminOnly()
@Controller('apps')
export class AppsController {
  constructor(
    private readonly dbs: DbService,
    private readonly provisioner: ProvisionClient,
  ) {}

  /** Apps in the company's plan. */
  @Get()
  async list(@CurrentCaller() caller: Caller) {
    const [company] = await this.dbs.db.select({ enabledApps: companies.enabledApps }).from(companies).where(eq(companies.id, caller.companyId)).limit(1);
    return (company?.enabledApps ?? []).filter((a): a is AppKey => (APPS as readonly string[]).includes(a)).map((app) => ({ app, ...APP_INFO[app] }));
  }

  /** Roles to choose from when giving someone access, read from the app itself. */
  @Get(':app/roles')
  roles(@Param('app') app: string) {
    if (!(APPS as readonly string[]).includes(app)) throw notFound('App');
    return this.provisioner.roles(app as AppKey);
  }
}
