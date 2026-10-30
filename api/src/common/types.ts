import type { Request } from 'express';

export const ROLES = ['owner', 'admin', 'agent'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
}

export interface TenantContext {
  tenantId: string;
  role: Role;
}

/** Express request after AuthGuard/TenantGuard have run. */
export interface AppRequest extends Request {
  user?: AuthUser;
  tenant?: TenantContext;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
