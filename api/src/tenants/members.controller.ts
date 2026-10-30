import { Body, ConflictException, Controller, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles, Tenant } from '../common/decorators';
import { ROLES } from '../common/types';
import type { AuthUser, Role, TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';

const RoleBody = z.object({ role: z.enum(ROLES) }).strict();

@Controller('tenants/:tid/members')
export class MembersController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'agent')
  async list(@Tenant() t: TenantContext) {
    const { rows } = await this.db.query(
      `SELECT u.id AS user_id, u.email, u.name, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
      [t.tenantId],
    );
    return rows;
  }

  @Patch(':uid')
  @Roles('owner')
  async changeRole(
    @Tenant() t: TenantContext,
    @CurrentUser() actor: AuthUser,
    @Param('uid', UuidPipe) uid: string,
    @Body(new ZodPipe(RoleBody)) body: z.infer<typeof RoleBody>,
  ) {
    return this.db.tx(async (client) => {
      // Lock the tenant's memberships so two concurrent demotions can't both pass the last-owner check.
      const { rows } = await client.query<{ user_id: string; role: Role }>(
        'SELECT user_id, role FROM memberships WHERE tenant_id = $1 FOR UPDATE',
        [t.tenantId],
      );
      const target = rows.find((r) => r.user_id === uid);
      if (!target) throw new NotFoundException('Member not found');
      if (target.role === body.role) return { user_id: uid, role: body.role };

      const owners = rows.filter((r) => r.role === 'owner').length;
      if (target.role === 'owner' && owners <= 1) {
        throw new ConflictException('A tenant must keep at least one owner');
      }

      await client.query('UPDATE memberships SET role = $3 WHERE tenant_id = $1 AND user_id = $2', [t.tenantId, uid, body.role]);
      await this.audit.record(
        {
          tenantId: t.tenantId,
          actorType: 'user',
          actorId: actor.id,
          action: 'member.role_changed',
          targetType: 'user',
          targetId: uid,
          metadata: { from: target.role, to: body.role },
        },
        client,
      );
      return { user_id: uid, role: body.role };
    });
  }
}
