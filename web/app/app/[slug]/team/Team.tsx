"use client";

import { useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { Empty, View } from "@/components/States";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { useTenant } from "@/lib/tenant-context";
import type { Role } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

export function Team() {
  const { tid, can, user } = useTenant();
  const members = useResource(() => api.members(tid), [tid]);
  const invites = useResource(() => (can.invite ? api.invites(tid) : Promise.resolve([])), [tid, can.invite]);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(uid: string, role: Role) {
    setError(null);
    try {
      const m = await api.changeRole(tid, uid, role);
      members.setData((prev) => prev?.map((x) => (x.user_id === uid ? { ...x, role: m.role ?? role } : x)) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Role not changed.");
    }
  }

  return (
    <div className="team">
      <section className="panel" aria-labelledby="members-h">
        <div className="panel__head">
          <h2 id="members-h" className="engraved">Members</h2>
          {!can.changeRoles && <span className="hint">Only the owner can change roles.</span>}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <View res={members} isEmpty={(d) => d.length === 0} empty={<Empty title="No members" />}>
          {(list) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr key={m.user_id}>
                      <td>
                        <b>{m.name}</b>
                        {m.user_id === user.id && <span className="chip chip--blue you">You</span>}
                      </td>
                      <td className="mono">{m.email}</td>
                      <td>
                        {can.changeRoles && m.user_id !== user.id ? (
                          <select
                            className="select select--sm"
                            value={m.role}
                            aria-label={`Role of ${m.name}`}
                            onChange={(e) => changeRole(m.user_id, e.target.value as Role)}
                          >
                            <option value="owner">Owner</option>
                            <option value="admin">Admin</option>
                            <option value="agent">Agent</option>
                          </select>
                        ) : (
                          <span className={`role role--${m.role}`}>{m.role}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </View>
      </section>

      <section className="panel" aria-labelledby="invite-h">
        <div className="panel__head">
          <h2 id="invite-h" className="engraved">Invite a teammate</h2>
        </div>
        {can.invite ? (
          <>
            <InviteForm onCreated={invites.reload} />
            <h3 className="engraved subhead">Pending invites</h3>
            <View res={invites} loadingRows={2}>
              {(list) => {
                const pending = list.filter((i) => !i.accepted_at);
                return pending.length === 0 ? (
                  <p className="muted">No pending invites.</p>
                ) : (
                  <ul className="invites">
                    {pending.map((i) => (
                      <li key={i.id}>
                        <span className="mono">{i.email}</span>
                        <span className={`role role--${i.role}`}>{i.role}</span>
                        <span className="hint">sent {timeAgo(i.created_at)}</span>
                      </li>
                    ))}
                  </ul>
                );
              }}
            </View>
          </>
        ) : (
          <p className="muted">Owners and admins can invite people. Ask one of them to add a teammate.</p>
        )}
      </section>
    </div>
  );
}

function InviteForm({ onCreated }: { onCreated: () => void }) {
  const { tid } = useTenant();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "agent">("agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  return (
    <form
      className="inviteform"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setLink(null);
        try {
          const { invite_url } = await api.createInvite(tid, email.trim(), role);
          setLink(invite_url);
          setEmail("");
          onCreated();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Invite not created.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="inviteform__row">
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sam@example.com" />
        </label>
        <label className="field">
          <span>Role</span>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as "admin" | "agent")}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create invite link"}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {link && (
        <div className="invitelink" role="status">
          <p className="hint">The demo doesn&apos;t send email. Share this link — it works once and expires in 7 days.</p>
          <div className="codeline">
            <code>{link}</code>
            <CopyButton text={link} />
          </div>
        </div>
      )}
    </form>
  );
}
