import { Module } from '@nestjs/common';
import { AccountsController, InvitesController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { OTP_SENDER, OtpService, TicketsService } from './accounts/otp.service';
import { otpSenderFromEnv } from './accounts/otp-senders';
import { BillingController, ConsoleController } from './billing/billing.controller';
import { BillingService } from './billing/billing.service';
import { ConsoleDashboardController, LogsIngestController } from './console/console.controller';
import { ConsoleDashboardService } from './console/console.service';
import { LogsService } from './console/logs.service';
import { CompanySetupService } from './company/setup.service';
import { InvitesService } from './invites/invites.service';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { Throttle } from './auth/throttle';
import { CompanyController } from './company/company.controller';
import { CompanyService } from './company/company.service';
import { DbService } from './db/db.service';
import { KeysService } from './keys/keys.service';
import { TokensService } from './keys/tokens.service';
import { AppsController } from './people/apps.controller';
import { PeopleController } from './people/people.controller';
import { PeopleService } from './people/people.service';
import { DepartmentsController } from './people/departments.controller';
import { DirectoryService } from './people/directory.service';
import { FlowsController } from './people/flows.controller';
import { FlowsService } from './people/flows.service';
import { ProvisionClient } from './provision/provision.client';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';

@Module({
  controllers: [AuthController, PeopleController, AppsController, RolesController, CompanyController, DepartmentsController, FlowsController, AccountsController, InvitesController, BillingController, ConsoleController, ConsoleDashboardController, LogsIngestController],
  providers: [
    DbService,
    Throttle,
    KeysService,
    TokensService,
    AuthService,
    PeopleService,
    ProvisionClient,
    RolesService,
    CompanyService,
    DirectoryService,
    FlowsService,
    CompanySetupService,
    TicketsService,
    OtpService,
    // One-time codes: the Platform log (OTP_SENDER=fake, default) or MSG91 (OTP_SENDER=msg91, PLAN.md §21.8).
    { provide: OTP_SENDER, useFactory: otpSenderFromEnv },
    AccountsService,
    InvitesService,
    BillingService,
    LogsService,
    ConsoleDashboardService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
