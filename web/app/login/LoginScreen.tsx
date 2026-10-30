"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { WakingUp } from "@/components/States";
import { api } from "@/lib/api";
import { DEMO_TENANTS } from "@/lib/config";
import { ApiError } from "@/lib/errors";
import { setSession } from "@/lib/session";
import type { LoginPayload, Role } from "@/lib/types";

const ROLES: { role: Role; can: string }[] = [
  { role: "owner", can: "Everything, including settings and roles" },
  { role: "admin", can: "Documents, invites and the audit log" },
  { role: "agent", can: "Conversations and tickets" },
];

export function LoginScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => alive && setAsleep(true), 2500);
    api.health().then((ok) => {
      clearTimeout(timer);
      if (alive) setAsleep(!ok);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  function enter(payload: LoginPayload, preferSlug?: string) {
    setSession(payload);
    const m = payload.memberships.find((x) => x.tenant_slug === preferSlug) ?? payload.memberships[0];
    if (!m) {
      setError("This account isn't a member of any workspace yet.");
      setBusy(null);
      return;
    }
    router.push(`/app/${m.tenant_slug}/overview`);
  }

  async function run(id: string, fn: () => Promise<LoginPayload>, preferSlug?: string) {
    setBusy(id);
    setError(null);
    try {
      enter(await fn(), preferSlug);
    } catch (e) {
      setBusy(null);
      if (e instanceof ApiError && e.unreachable) setAsleep(true);
      else setError(e instanceof Error ? e.message : "Sign-in failed.");
    }
  }

  return (
    <div className="login">
      <header className="login__top">
        <Logo />
      </header>
      <main className="login__main">
        <section className="login__demo panel" aria-labelledby="demo-title">
          <div className="login__intro">
            <h1 id="demo-title" className="login__h1">
              Open the console
            </h1>
            <p className="muted">
              Pick a fictional company and a role. Each button signs you in as that company&apos;s demo user — the
              server checks the role on every request.
            </p>
          </div>
          {asleep && (
            <div className="login__waking well">
              <WakingUp compact onReady={() => setAsleep(false)} />
            </div>
          )}
          <div className="switchboard">
            {DEMO_TENANTS.map((t) => (
              <div key={t.slug} className="switchboard__row">
                <div className="switchboard__tenant">
                  <span className="switchboard__name">{t.name}</span>
                  <span className="engraved">{t.blurb}</span>
                </div>
                <div className="switchboard__roles">
                  {ROLES.map(({ role }) => {
                    const id = `${t.slug}:${role}`;
                    return (
                      <button
                        key={role}
                        className="switch"
                        disabled={busy !== null}
                        onClick={() => run(id, () => api.demoLogin(t.slug, role), t.slug)}
                        aria-describedby={`can-${role}`}
                      >
                        <span className={`switch__led${busy === id ? " is-on" : ""}`} aria-hidden="true" />
                        <span className="switch__label">
                          {busy === id ? "Signing in…" : `Enter as ${role[0].toUpperCase()}${role.slice(1)}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <ul className="login__roles">
            {ROLES.map(({ role, can }) => (
              <li key={role} id={`can-${role}`}>
                <b>{role[0].toUpperCase() + role.slice(1)}</b> — {can}
              </li>
            ))}
          </ul>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="login__form" aria-labelledby="pw-title">
          <h2 id="pw-title" className="engraved">
            Or sign in with email
          </h2>
          <form
            className="login__fields"
            onSubmit={(e) => {
              e.preventDefault();
              run("password", () => api.login(email, password));
            }}
          >
            <label className="field">
              <span>Email</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@northwind.demo"
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="btn" type="submit" disabled={busy !== null}>
              {busy === "password" ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="hint">All accounts and companies here are fictional.</p>
        </section>
      </main>
    </div>
  );
}
