import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DbService } from '../db/db.service';
import { ROLES_KEY } from './decorators';
import { AppRequest, Role, UUID_RE } from './types';

/**
 * Global guard for every route with a `:tid` param.
 *
 * The role is loaded from `memberships` on every request; the JWT only proves
 * identity. Rules (from the contract):
 *   - not a member of the tenant (or tenant doesn't exist) → 404, so tenant ids can't be probed
 *   - member but role not allowed                          → 403
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const tid: unknown = req.params?.tid;
    if (tid === undefined) return true; // not a tenant-scoped route
    if (!req.user) throw new ForbiddenException(); // AuthGuard runs first; defensive
    if (typeof tid !== 'string' || !UUID_RE.test(tid)) throw new NotFoundException('Tenant not found');

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!allowed || allowed.length === 0) {
      throw new ForbiddenException('Route has no role policy'); // fail closed
    }

    const { rows } = await this.db.query<{ role: Role }>(
      'SELECT role FROM memberships WHERE user_id = $1 AND tenant_id = $2',
      [req.user.id, tid],
    );
    const membership = rows[0];
    if (!membership) throw new NotFoundException('Tenant not found');
    if (!allowed.includes(membership.role)) throw new ForbiddenException('Insufficient role');

    req.tenant = { tenantId: tid, role: membership.role };
    return true;
  }
}
