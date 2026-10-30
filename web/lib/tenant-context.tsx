"use client";

import { createContext, useContext } from "react";
import type { Membership, Role, Tenant, User } from "./types";

export interface Permissions {
  manageDocuments: boolean;
  invite: boolean;
  editSettings: boolean;
  changeRoles: boolean;
  viewAudit: boolean;
}

export function permissionsFor(role: Role): Permissions {
  return {
    manageDocuments: role === "owner" || role === "admin",
    invite: role === "owner" || role === "admin",
    editSettings: role === "owner",
    changeRoles: role === "owner",
    viewAudit: role === "owner" || role === "admin",
  };
}

export interface TenantContextValue {
  slug: string;
  tid: string;
  role: Role;
  membership: Membership;
  memberships: Membership[];
  user: User;
  can: Permissions;
  tenant: Tenant | null;
  threshold: number;
  setTenant: (t: Tenant) => void;
}

export const TenantContext = createContext<TenantContextValue | null>(null);

export function useTenant(): TenantContextValue {
  const v = useContext(TenantContext);
  if (!v) throw new Error("useTenant must be used inside the /app/[slug] shell");
  return v;
}
