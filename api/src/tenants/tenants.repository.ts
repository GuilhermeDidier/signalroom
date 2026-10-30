import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  widget_key: string;
  allowed_origins: string[];
  brand_color: string;
  confidence_threshold: number;
  created_at: Date;
}

const COLUMNS = `id, name, slug, widget_key, allowed_origins, brand_color,
  confidence_threshold::float8 AS confidence_threshold, created_at`;

@Injectable()
export class TenantsRepository {
  constructor(private readonly db: DbService) {}

  async findById(id: string, q: Queryable = this.db): Promise<TenantRow | undefined> {
    const { rows } = await q.query<TenantRow>(`SELECT ${COLUMNS} FROM tenants WHERE id = $1`, [id]);
    return rows[0];
  }

  async findByWidgetKey(key: string): Promise<TenantRow | undefined> {
    const { rows } = await this.db.query<TenantRow>(`SELECT ${COLUMNS} FROM tenants WHERE widget_key = $1`, [key]);
    return rows[0];
  }

  async updateSettings(
    id: string,
    patch: { confidence_threshold?: number; allowed_origins?: string[]; brand_color?: string },
    q: Queryable,
  ): Promise<TenantRow> {
    const { rows } = await q.query<TenantRow>(
      `UPDATE tenants SET
         confidence_threshold = COALESCE($2, confidence_threshold),
         allowed_origins      = COALESCE($3, allowed_origins),
         brand_color          = COALESCE($4, brand_color)
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, patch.confidence_threshold ?? null, patch.allowed_origins ?? null, patch.brand_color ?? null],
    );
    return rows[0];
  }
}
