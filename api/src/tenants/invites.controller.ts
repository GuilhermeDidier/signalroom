import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  GoneException,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { UsersRepository } from '../auth/users.repository';
import { CurrentUser, Public, Roles, Tenant } from '../common/decorators';
import type { AppRequest, AuthUser, TenantContext } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db/db.service';

const InviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['admin', 'agent']),
});

/** name/password create a NEW account; an existing account accepts while signed in, with an empty body. */
const AcceptBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(8).max(200).optional(),
});

/**
 * Invite tokens are 256-bit random values. Only their SHA-256 is stored, so a
 * leaked database (or audit export) can't be used to join a tenant.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface InviteLookup {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  email: string;
  role: 'admin' | 'agent';
  accepted_at: Date | null;
  expires_at: Date;
}

@Controller()
export class InvitesController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post('tenants/:tid/invites')
  @Roles('owner', 'admin')
  async create(
    @Tenant() t: TenantContext,
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(InviteBody)) body: z.infer<typeof InviteBody>,
  ) {
    const { rows: existing } = await this.db.query(
      `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1 AND lower(u.email) = $2`,
      [t.tenantId, body.email],
    );
    if (existing.length) throw new ConflictException('That user is already a member');

    const token = randomBytes(32).toString('base64url');
    return this.db.tx(async (client) => {
      const { rows } = await client.query<{ id: string; expires_at: Date }>(
        `INSERT INTO invites (tenant_id, email, role, token, invited_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, expires_at`,
        [t.tenantId, body.email, body.role, hashInviteToken(token), actor.id],
      );
      const invite = rows[0];
      await this.audit.record(
        {
          tenantId: t.tenantId,
          actorType: 'user',
          actorId: actor.id,
          action: 'invite.created',
          targetType: 'invite',
          targetId: invite.id,
          metadata: { email: body.email, role: body.role },
        },
        client,
      );
      return {
        id: invite.id,
        email: body.email,
        role: body.role,
        expires_at: invite.expires_at,
        invite_url: `${this.cfg.webUrl}/invite/${token}`,
      };
    });
  }

  @Get('tenants/:tid/invites')
  @Roles('owner', 'admin', 'agent')
  async list(@Tenant() t: TenantContext) {
    const { rows } = await this.db.query(
      `SELECT i.id, i.email, i.role, i.accepted_at, i.expires_at, i.created_at,
              u.name AS invited_by_name,
              CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted'
                   WHEN i.expires_at < now() THEN 'expired'
                   ELSE 'pending' END AS status
         FROM invites i LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.tenant_id = $1
        ORDER BY i.created_at DESC`,
      [t.tenantId],
    );
    return rows;
  }

  @Public()
  @Get('invites/:token')
  async show(@Param('token') token: string) {
    const invite = await this.lookup(token);
    assertUsable(invite);
    return {
      // Tells the invite page whether to show "create account" or "sign in to accept".
      account_exists: (await this.users.findByEmail(invite.email)) !== undefined,
      tenant_name: invite.tenant_name,
      tenant_slug: invite.tenant_slug,
      email: invite.email,
      role: invite.role,
      expires_at: invite.expires_at,
    };
  }

  @Public()
  @Post('invites/:token/accept')
  async accept(@Param('token') token: string, @Body(new ZodPipe(AcceptBody)) body: z.infer<typeof AcceptBody>, @Req() req: AppRequest) {
    const invite = await this.lookup(token);
    assertUsable(invite);

    // An existing account must already be signed in as itself. This route never
    // checks passwords, so it can't be used as a brute-force oracle that bypasses
    // the login rate limit.
    const existing = await this.users.findByEmail(invite.email);
    let newAccount: { name: string; password: string } | undefined;
    if (existing) {
      if ((await this.callerId(req)) !== existing.id) {
        throw new ConflictException('This email already has an account: sign in as that user, then accept the invite');
      }
    } else {
      if (!body.name || !body.password) {
        throw new BadRequestException('name and password (min 8 chars) are required to create your account');
      }
      newAccount = { name: body.name, password: body.password };
    }

    return this.db.tx(async (client) => {
      // Claim the invite atomically: a token can be redeemed exactly once.
      const claimed = await client.query(
        `UPDATE invites SET accepted_at = now()
          WHERE id = $1 AND accepted_at IS NULL AND expires_at > now()`,
        [invite.id],
      );
      if (claimed.rowCount !== 1) throw new GoneException('Invite already used or expired');

      const user = newAccount
        ? await this.users.create(invite.email, newAccount.name, await bcrypt.hash(newAccount.password, 10), client)
        : existing;
      if (!user) throw new Error('invite accept: no user resolved'); // unreachable by construction

      const inserted = await client.query(
        `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, tenant_id) DO NOTHING`,
        [user.id, invite.tenant_id, invite.role],
      );
      if (inserted.rowCount !== 1) throw new ConflictException('Already a member of this tenant');

      await this.audit.record(
        {
          tenantId: invite.tenant_id,
          actorType: 'user',
          actorId: user.id,
          action: 'invite.accepted',
          targetType: 'invite',
          targetId: invite.id,
          metadata: { email: invite.email, role: invite.role },
        },
        client,
      );
      return this.auth.issue(user, { method: 'invite' }, client);
    });
  }

  /** Optional auth on a public route: the user id from a valid Bearer token, if any. */
  private async callerId(req: AppRequest): Promise<string | undefined> {
    const [scheme, jwt] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !jwt) return undefined;
    try {
      return (await this.jwt.verifyAsync<{ sub: string }>(jwt)).sub;
    } catch {
      return undefined; // invalid/expired token = anonymous caller
    }
  }

  private async lookup(token: string): Promise<InviteLookup> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundException('Invite not found');
    const { rows } = await this.db.query<InviteLookup>(
      `SELECT i.id, i.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, i.email, i.role, i.accepted_at, i.expires_at
         FROM invites i JOIN tenants t ON t.id = i.tenant_id
        WHERE i.token = $1`,
      [hashInviteToken(token)],
    );
    if (!rows[0]) throw new NotFoundException('Invite not found');
    return rows[0];
  }
}

function assertUsable(invite: InviteLookup): void {
  if (invite.accepted_at) throw new GoneException('Invite already used');
  if (invite.expires_at.getTime() < Date.now()) throw new GoneException('Invite expired');
}
