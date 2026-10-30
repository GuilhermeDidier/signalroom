"use client";

import { useState } from "react";
import { Empty, View } from "@/components/States";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useTenant } from "@/lib/tenant-context";
import type { AuditEntry } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

function actor(a: AuditEntry) {
  if (a.actor_type === "user") return a.actor_email ?? a.actor_name ?? a.actor_id ?? "user";
  if (a.actor_type === "widget") return `visitor ${a.actor_id ?? ""}`.trim();
  return a.actor_type === "ai" ? "AI" : "system";
}

function details(meta: Record<string, unknown>) {
  const entries = Object.entries(meta ?? {});
  if (!entries.length) return "—";
  return entries
    .map(([k, v]) => {
      if (v && typeof v === "object" && "from" in v && "to" in v) {
        const o = v as { from: unknown; to: unknown };
        return `${k}: ${String(o.from)} → ${String(o.to)}`;
      }
      return `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`;
    })
    .join(" · ");
}

export function Audit() {
  const { tid, can } = useTenant();
  const res = useResource(can.viewAudit ? () => api.audit(tid) : null, [tid, can.viewAudit]);
  const [action, setAction] = useState("all");

  if (!can.viewAudit) {
    return (
      <section className="panel">
        <Empty title="Owners and admins only">The audit log records sensitive actions. Your role can&apos;t open it.</Empty>
      </section>
    );
  }

  return (
    <section className="panel">
      <View res={res} isEmpty={(d) => d.length === 0} empty={<Empty title="No audit entries yet" />}>
        {(entries) => {
          const actions = Array.from(new Set(entries.map((e) => e.action))).sort();
          const shown = action === "all" ? entries : entries.filter((e) => e.action === action);
          return (
            <>
              <div className="panel__head">
                <p className="hint">Append-only: rows can be added, never edited or deleted (enforced by a database trigger).</p>
                <label className="inline-field">
                  <span className="engraved">Action</span>
                  <select className="select select--sm" value={action} onChange={(e) => setAction(e.target.value)}>
                    <option value="all">All actions ({entries.length})</option>
                    {actions.map((a) => (
                      <option key={a} value={a}>
                        {a} ({entries.filter((e) => e.action === a).length})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="table-wrap">
                <table className="table audit">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap kbd-num">{dateTime(e.created_at)}</td>
                        <td className="nowrap">
                          <span className={`actor actor--${e.actor_type}`}>{actor(e)}</span>
                        </td>
                        <td className="nowrap">
                          <code className={`action${/escalated|failed|pii/.test(e.action) ? " action--hot" : ""}`}>{e.action}</code>
                        </td>
                        <td className="nowrap mono muted">
                          {e.target_type ? `${e.target_type}:${e.target_id ?? ""}` : "—"}
                        </td>
                        <td className="audit__details">{details(e.metadata)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </View>
    </section>
  );
}
