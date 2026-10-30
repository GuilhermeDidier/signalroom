"use client";

import Link from "next/link";
import { useState } from "react";
import { NotifyBadge } from "@/components/NotifyBadge";
import { Empty, View } from "@/components/States";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { timeAgo } from "@/lib/format";
import { useTenant } from "@/lib/tenant-context";
import type { Ticket, TicketStatus } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

const SOURCE: Record<Ticket["source"], string> = {
  ai_tool: "AI tool call",
  escalation: "Escalation",
  human: "Agent",
};

export function Tickets() {
  const { tid, slug } = useTenant();
  const res = useResource(() => api.tickets(tid), [tid]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  async function changeStatus(t: Ticket, status: TicketStatus) {
    setSaving(t.id);
    setError(null);
    try {
      const updated = await api.updateTicket(tid, t.id, { status });
      res.setData((prev) => prev?.map((x) => (x.id === t.id ? { ...x, ...updated } : x)) ?? prev);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Status not changed.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="engraved">Handoff queue</h2>
        <span className="hint">Opened by the AI when it escalates. n8n gets a signed webhook for each one.</span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <View
        res={res}
        loadingRows={6}
        isEmpty={(d) => d.length === 0}
        empty={<Empty title="No tickets">When the assistant can&apos;t answer confidently, it opens a ticket here.</Empty>}
      >
        {(tickets) => (
          <div className="table-wrap">
            <table className="table tickets">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Subject</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Notification</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {[...tickets]
                  .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  .map((t) => (
                    <tr key={t.id} className={t.status === "closed" ? "is-closed" : ""}>
                      <td className="kbd-num">{t.number}</td>
                      <td className="tickets__subject">
                        {t.conversation_id ? (
                          <Link href={`/app/${slug}/conversations/${t.conversation_id}`}>{t.subject}</Link>
                        ) : (
                          t.subject
                        )}
                        {t.reason && <span className="tickets__reason mono">{t.reason}</span>}
                      </td>
                      <td>
                        <span className={`prio prio--${t.priority}`}>{t.priority}</span>
                      </td>
                      <td>
                        <select
                          className={`select select--sm status--${t.status}`}
                          value={t.status}
                          disabled={saving === t.id}
                          aria-label={`Status of ticket ${t.number}`}
                          onChange={(e) => changeStatus(t, e.target.value as TicketStatus)}
                        >
                          <option value="open">Open</option>
                          <option value="pending">Pending</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                      <td className="nowrap">{SOURCE[t.source] ?? t.source}</td>
                      <td>
                        <NotifyBadge status={t.notification_status} />
                      </td>
                      <td className="nowrap muted">{timeAgo(t.created_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </View>
    </section>
  );
}
