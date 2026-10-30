import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';
import type { Role } from '../common/types';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
}

export interface MembershipView {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: Role;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DbService) {}

  async findByEmail(email: string, q: Queryable = this.db): Promise<UserRow | undefined> {
    const { rows } = await q.query<UserRow>(
      'SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    return rows[0];
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const { rows } = await this.db.query<UserRow>('SELECT id, email, name, password_hash FROM users WHERE id = $1', [id]);
    return rows[0];
  }

  async create(email: string, name: string, passwordHash: string, q: Queryable = this.db): Promise<UserRow> {
    const { rows } = await q.query<UserRow>(
      `INSERT INTO users (email, name, password_hash) VALUES (lower($1), $2, $3)
       RETURNING id, email, name, password_hash`,
      [email, name, passwordHash],
    );
    return rows[0];
  }

  async memberships(userId: string, q: Queryable = this.db): Promise<MembershipView[]> {
    const { rows } = await q.query<MembershipView>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role
         FROM memberships m JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = $1
        ORDER BY t.name`,
      [userId],
    );
    return rows;
  }
}
