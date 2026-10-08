import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { CompanyController } from './company/company.controller';
import { CompanyService } from './company/company.service';
import { DbService } from './db/db.service';
import { KeysService } from './keys/keys.service';
import { TokensService } from './keys/tokens.service';
import { AppsController } from './people/apps.controller';
import { PeopleController } from './people/people.controller';
import { PeopleService } from './people/people.service';
import { ProvisionClient } from './provision/provision.client';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';

@Module({
  controllers: [AuthController, PeopleController, AppsController, RolesController, CompanyController],
  providers: [DbService, KeysService, TokensService, AuthService, PeopleService, ProvisionClient, RolesService, CompanyService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
