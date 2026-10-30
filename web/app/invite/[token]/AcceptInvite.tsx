"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { View } from "@/components/States";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { setSession } from "@/lib/session";
import { useResource } from "@/lib/use-resource";

export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const res = useResource(() => api.publicInvite(token), [token]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="login">
      <header className="login__top">
        <Logo />
      </header>
      <main className="invite panel">
        <View res={res}>
          {(inv) =>
            inv.accepted_at ? (
              <div className="invite__done">
                <h1 className="login__h1">Invite already used</h1>
                <p className="muted">This link was accepted already. Sign in with the account it created.</p>
                <Link className="btn" href="/login">
                  Sign in
                </Link>
              </div>
            ) : (
              <form
                className="invite__form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError(null);
                  try {
                    const payload = await api.acceptInvite(token, name.trim(), password);
                    setSession(payload);
                    const m = payload.memberships[0];
                    router.push(m ? `/app/${m.tenant_slug}/overview` : "/login");
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : "Invite not accepted.");
                    setBusy(false);
                  }
                }}
              >
                <p className="engraved">Invitation</p>
                <h1 className="login__h1">Join {inv.tenant_name}</h1>
                <p className="muted">
                  You&apos;re invited as <span className={`role role--${inv.role}`}>{inv.role}</span> with{" "}
                  <span className="mono">{inv.email}</span>.
                </p>
                <label className="field">
                  <span>Your name</span>
                  <input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </label>
                <label className="field">
                  <span>Choose a password</span>
                  <input
                    className="input"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <span className="hint">At least 8 characters.</span>
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? "Joining…" : `Join ${inv.tenant_name}`}
                </button>
              </form>
            )
          }
        </View>
      </main>
    </div>
  );
}
