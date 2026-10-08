import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { InternalController } from './internal.controller';
import { InternalPeopleController } from './internal-people.controller';

@Global()
@Module({
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [AuthController, InternalController, InternalPeopleController],
  exports: [AuthService],
})
export class AuthModule {}
