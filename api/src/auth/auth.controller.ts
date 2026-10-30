import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/decorators';
import { ROLES } from '../common/types';
import type { AppRequest, AuthUser } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const LoginBody = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

const DemoBody = z.object({
  tenant_slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  role: z.enum(ROLES),
});

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  login(@Body(new ZodPipe(LoginBody)) body: z.infer<typeof LoginBody>, @Req() req: AppRequest) {
    return this.auth.login(body.email, body.password, req.ip ?? '');
  }

  @Public()
  @Post('auth/demo')
  @HttpCode(200)
  demo(@Body(new ZodPipe(DemoBody)) body: z.infer<typeof DemoBody>, @Req() req: AppRequest) {
    return this.auth.demoLogin(body.tenant_slug, body.role, req.ip ?? '');
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
