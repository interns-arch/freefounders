import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { InternalFlowsController } from './internal-flows.controller';

/** Endpoints the FreeFounders Platform's cross-app rules call (PLAN.md §17.4). */
@Module({
  imports: [EmployeesModule, OnboardingModule],
  controllers: [InternalFlowsController],
})
export class PlatformFlowsModule {}
