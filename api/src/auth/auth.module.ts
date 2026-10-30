import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../common/auth.guard';
import { RateLimiter } from '../common/rate-limiter';
import { TenantGuard } from '../common/tenant.guard';
import { APP_CONFIG, AppConfig } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersRepository } from './users.repository';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({
        secret: cfg.jwtSecret,
        // JWT_TTL is validated as <n>[smhd] in config.ts, which is what jsonwebtoken's StringValue accepts.
        signOptions: { expiresIn: cfg.jwtTtl as `${number}h`, algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    RateLimiter,
    // Order matters: identity first, then tenant membership/role.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
  exports: [AuthService, UsersRepository, RateLimiter, JwtModule],
})
export class AuthModule {}
