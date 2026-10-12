import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { type Caller, CurrentCaller, Needs, Public, uuidParam, ZodPipe } from '../common/http';
import type { ModuleSwitches } from '../db/schema';
import { CompanyService, logoSchema, modulesSchema, profileSchema, type ProfileInput } from './company.service';

/** Settings Center: the company's profile, logo and module switches (the Company settings permission). */
@Controller()
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  @Needs('company.settings')
  @Get('company')
  get(@CurrentCaller() caller: Caller) {
    return this.company.get(caller);
  }

  @Needs('company.settings')
  @Patch('company')
  update(@CurrentCaller() caller: Caller, @Body(new ZodPipe(profileSchema.partial())) body: Partial<ProfileInput>) {
    return this.company.update(caller, body);
  }

  @Needs('company.settings')
  @Put('company/logo')
  setLogo(@CurrentCaller() caller: Caller, @Body(new ZodPipe(logoSchema)) body: { image: string }) {
    return this.company.setLogo(caller, body.image);
  }

  @Needs('company.settings')
  @Delete('company/logo')
  @HttpCode(200)
  removeLogo(@CurrentCaller() caller: Caller) {
    return this.company.setLogo(caller, null);
  }

  @Needs('company.settings')
  @Put('company/modules')
  setModules(@CurrentCaller() caller: Caller, @Body(new ZodPipe(modulesSchema)) body: ModuleSwitches) {
    return this.company.setModules(caller, body);
  }

  /** Public: the apps show it in their headers, and it carries nothing private. */
  @Public()
  @Get('brand/:companyId/logo')
  async logo(@Param('companyId') companyId: string, @Res() res: Response) {
    const logo = await this.company.logo(uuidParam(companyId));
    if (!logo) throw new NotFoundException('No logo');
    res
      .set({
        'content-type': logo.type,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'",
      })
      .send(logo.data);
  }
}
