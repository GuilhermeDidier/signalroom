import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles, Tenant } from '../common/decorators';
import type { TenantContext } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from './audit.service';

const AuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  action: z.string().max(64).optional(),
  before: z.coerce.number().int().positive().optional(),
});

@Controller('tenants/:tid/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('owner', 'admin')
  async list(@Tenant() t: TenantContext, @Query(new ZodPipe(AuditQuery)) q: z.infer<typeof AuditQuery>) {
    return this.audit.list(t.tenantId, q);
  }
}
