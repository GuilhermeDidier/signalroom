import { Body, Controller, Get, NotFoundException, Patch } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles, Tenant } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';
import { TenantsRepository } from './tenants.repository';

/** An origin is scheme://host[:port] with nothing after it. */
const Origin = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === v.replace(/\/$/, '');
    } catch {
      return false;
    }
  }, 'must be an origin like https://example.com')
  .transform((v) => v.replace(/\/$/, ''));

const SettingsBody = z
  .object({
    confidence_threshold: z.number().min(0).max(1).optional(),
    allowed_origins: z.array(Origin).max(20).optional(),
    brand_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #1f5fd1')
      .optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'no settings given');

@Controller('tenants/:tid')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsRepository,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'agent')
  async get(@Tenant() t: TenantContext) {
    const tenant = await this.tenants.findById(t.tenantId);
    if (!tenant) throw new NotFoundException();
    return { ...tenant, role: t.role };
  }

  @Patch('settings')
  @Roles('owner')
  async updateSettings(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(SettingsBody)) body: z.infer<typeof SettingsBody>,
  ) {
    return this.db.tx(async (client) => {
      const before = await this.tenants.findById(t.tenantId, client);
      if (!before) throw new NotFoundException();
      const after = await this.tenants.updateSettings(t.tenantId, body, client);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(body) as (keyof typeof body)[]) {
        changes[key] = { from: before[key], to: after[key] };
      }
      await this.audit.record(
        { tenantId: t.tenantId, actorType: 'user', actorId: user.id, action: 'settings.updated', targetType: 'tenant', targetId: t.tenantId, metadata: { changes } },
        client,
      );
      return after;
    });
  }
}
