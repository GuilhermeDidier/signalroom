"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { Empty, WakingUp } from "@/components/States";
import { api } from "@/lib/api";
import { MOCK } from "@/lib/config";
import { ApiError } from "@/lib/errors";
import { setSession, updateSessionMe } from "@/lib/session";
import { TenantContext, permissionsFor, type TenantContextValue } from "@/lib/tenant-context";
import type { Tenant } from "@/lib/types";
import { useSession } from "@/lib/use-session";

const NAV = [
  { seg: "overview", label: "Overview" },
  { seg: "conversations", label: "Conversations" },
  { seg: "documents", label: "Documents" },
  { seg: "tickets", label: "Tickets" },
  { seg: "team", label: "Team" },
  { seg: "settings", label: "Settings" },
  { seg: "audit", label: "Audit" },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const [tenantState, setTenantState] = useState<{ tid: string; tenant: Tenant } | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [retry, setRetry] = useState(0);

  const membership = session?.memberships.find((m) => m.tenant_slug === slug) ?? null;
  const tid = membership?.tenant_id ?? null;

  // Not signed in → login.
  useEffect(() => {
    if (session === null) router.replace(`/login`);
  }, [session, router]);

  // Refresh memberships (roles may have changed since sign-in).
  useEffect(() => {
    if (!session) return;
    api
      .me()
      .then(updateSessionMe)
      .catch(() => undefined); // tenant fetch below surfaces connectivity problems
    // Only on first mount for this token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  useEffect(() => {
    if (!tid) return;
    let alive = true;
    api
      .tenant(tid)
      .then((t) => alive && setTenantState({ tid, tenant: t }))
      .catch((e: unknown) => {
        if (alive && e instanceof ApiError && e.unreachable) setAsleep(true);
      });
    return () => {
      alive = false;
    };
  }, [tid, retry]);

  const tenant = tenantState && tenantState.tid === tid ? tenantState.tenant : null;

  const ctx = useMemo<TenantContextValue | null>(() => {
    if (!session || !membership) return null;
    return {
      slug,
      tid: membership.tenant_id,
      role: membership.role,
      membership,
      memberships: session.memberships,
      user: session.user,
      can: permissionsFor(membership.role),
      tenant,
      threshold: tenant?.confidence_threshold ?? 0.55,
      setTenant: (t) => setTenantState({ tid: t.id, tenant: t }),
    };
  }, [session, membership, slug, tenant]);

  if (session === undefined || session === null) return <div className="shell-boot" aria-busy="true" />;

  const section = pathname.split("/")[3] ?? "overview";
  const current = NAV.find((n) => n.seg === section);

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail__brand">
          <Logo href="/" />
        </div>
        <div className="rail__tenant">
          <label className="engraved" htmlFor="tenant-switch">
            Workspace
          </label>
          <select
            id="tenant-switch"
            className="select rail__select"
            value={slug}
            onChange={(e) => router.push(`/app/${e.target.value}/${section}`)}
          >
            {session.memberships.map((m) => (
              <option key={m.tenant_id} value={m.tenant_slug}>
                {m.tenant_name}
              </option>
            ))}
            {!membership && <option value={slug}>{slug}</option>}
          </select>
        </div>
        <nav className="rail__nav" aria-label="Sections">
          {NAV.map((n) => {
            const locked = n.seg === "audit" && membership && !permissionsFor(membership.role).viewAudit;
            const active = n.seg === section;
            if (locked) {
              return (
                <span key={n.seg} className="navitem is-locked" title="Owners and admins only">
                  <span className="navitem__led" aria-hidden="true" />
                  {n.label}
                  <span className="navitem__lock">Owner/admin</span>
                </span>
              );
            }
            return (
              <Link
                key={n.seg}
                href={`/app/${slug}/${n.seg}`}
                className={`navitem${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="navitem__led" aria-hidden="true" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <p className="rail__note">
          Fictional company · synthetic data{MOCK ? " · mock mode" : ""}
        </p>
      </aside>

      <div className="shell__main">
        <header className="topbar">
          <h1 className="topbar__title">{current?.label ?? "Conversation"}</h1>
          <div className="topbar__who">
            {membership && <span className={`role role--${membership.role}`}>{membership.role}</span>}
            <span className="topbar__user">{session.user.name || session.user.email}</span>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setSession(null);
                router.push("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="content">
          {asleep ? (
            <div className="panel">
              <WakingUp
                onReady={() => {
                  setAsleep(false);
                  setRetry((n) => n + 1);
                }}
              />
            </div>
          ) : !ctx ? (
            <div className="panel">
              <Empty
                title="You're not a member of this workspace"
                action={
                  <Link className="btn" href="/login">
                    Choose a workspace
                  </Link>
                }
              >
                Your account has no role in “{slug}”. Switch workspace from the menu, or sign in as a different demo
                user.
              </Empty>
            </div>
          ) : (
            <TenantContext.Provider value={ctx}>{children}</TenantContext.Provider>
          )}
        </main>
      </div>
    </div>
  );
}
