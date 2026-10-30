import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AuditService } from '../audit/audit.service';
import { RateLimiter } from '../common/rate-limiter';
import type { Role } from '../common/types';
import { APP_CONFIG, AppConfig } from '../config';
import { Queryable } from '../db/db.service';
import { MembershipView, UserRow, UsersRepository } from './users.repository';

export interface LoginPayload {
  token: string;
  user: { id: string; email: string; name: string };
  memberships: MembershipView[];
}

// Compared against when the email doesn't exist, so response time doesn't reveal accounts.
const DUMMY_HASH = bcrypt.hashSync('signalroom-dummy-password', 10);
// Keyed by (email, ip) so an attacker elsewhere can't lock a user out, plus a
// per-IP ceiling against credential stuffing across many emails.
const LOGIN_ATTEMPTS_PER_EMAIL_IP = 10;
const LOGIN_ATTEMPTS_PER_IP = 50;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async login(email: string, password: string, ip: string): Promise<LoginPayload> {
    for (const [key, limit] of [
      [`login:ip:${ip}`, LOGIN_ATTEMPTS_PER_IP],
      [`login:email-ip:${email.toLowerCase()}:${ip}`, LOGIN_ATTEMPTS_PER_EMAIL_IP],
    ] as const) {
      const rl = await this.limiter.hit(key, limit, LOGIN_WINDOW_MS);
      if (!rl.allowed) throw new HttpException('Too many login attempts, try again later', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.users.findByEmail(email);
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    return this.issue(user, { ip, method: 'password' });
  }

  async demoLogin(slug: string, role: Role, ip: string): Promise<LoginPayload> {
    // Hidden (404) unless the deployment is explicitly a demo.
    if (!this.cfg.demoMode) throw new NotFoundException();
    const user = await this.users.findByEmail(`${role}@${slug}.demo`);
    if (!user) throw new NotFoundException('Demo user not found; run the seed script');
    return this.issue(user, { ip, method: 'demo' });
  }

  async me(userId: string): Promise<Omit<LoginPayload, 'token'>> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    return { user: publicUser(user), memberships: await this.users.memberships(user.id) };
  }

  /**
   * Builds the login payload and writes one `auth.login` audit row per tenant
   * the user belongs to (audit is tenant-scoped; a login is visible to each).
   */
  async issue(user: UserRow, meta: Record<string, unknown>, q?: Queryable): Promise<LoginPayload> {
    const memberships = await this.users.memberships(user.id, q);
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    const tenants = memberships.length ? memberships.map((m) => m.tenant_id) : [null];
    for (const tenantId of tenants) {
      await this.audit.record(
        { tenantId, actorType: 'user', actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, metadata: meta },
        q,
      );
    }
    return { token, user: publicUser(user), memberships };
  }
}

export function publicUser(u: UserRow) {
  return { id: u.id, email: u.email, name: u.name };
}
