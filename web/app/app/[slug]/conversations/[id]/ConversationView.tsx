"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Breakdown, CitationList, RedactionBadges, RichText } from "@/components/Answer";
import { Alarm, Lamp } from "@/components/Lamp";
import { NotifyBadge } from "@/components/NotifyBadge";
import { View } from "@/components/States";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { dateTime, intentLabel, timeAgo } from "@/lib/format";
import { useTenant } from "@/lib/tenant-context";
import type { ConversationDetail, Message } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

export function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const { tid, slug } = useTenant();
  const res = useResource(() => api.conversation(tid, id), [tid, id]);

  return (
    <>
      <div className="toolbar">
        <Link href={`/app/${slug}/conversations`} className="backlink">
          ← All conversations
        </Link>
      </div>
      <View res={res} loadingRows={9}>
        {(c) => <Detail c={c} onMessage={(m) => res.setData((prev) => (prev ? { ...prev, messages: [...prev.messages, m] } : prev))} />}
      </View>
    </>
  );
}

function Detail({ c, onMessage }: { c: ConversationDetail; onMessage: (m: Message) => void }) {
  const { slug, threshold } = useTenant();
  const escalated = c.status === "escalated";
  const ticket = c.ticket_full;

  return (
    <div className="convdetail">
      <section className="panel transcript" aria-label="Transcript">
        <header className="transcript__head">
          <div>
            <p className="engraved">Visitor</p>
            <p className="mono">{c.visitor_id ?? "unknown"}</p>
          </div>
          <div>
            <p className="engraved">Started</p>
            <p>{dateTime(c.created_at)}</p>
          </div>
          <div>
            <p className="engraved">Status</p>
            <p>
              {escalated ? (
                <Alarm>Escalated{c.ticket ? ` · #${c.ticket.number}` : ""}</Alarm>
              ) : (
                <span className={`chip ${c.status === "resolved" ? "chip--green" : "chip--blue"}`}>
                  {c.status === "resolved" ? "Resolved" : "Open"}
                </span>
              )}
            </p>
          </div>
        </header>

        <ol className="msgs">
          {c.messages.map((m) => (
            <MessageItem key={m.id} m={m} threshold={threshold} slug={slug} />
          ))}
        </ol>

        <ReplyBox conversationId={c.id} onSent={onMessage} />
      </section>

      <aside className="convside">
        {escalated && (
          <section className="ticketcard">
            <div className="ticketcard__head">
              <Alarm>Human needed</Alarm>
              {c.ticket && <span className="ticketcard__num kbd-num">#{c.ticket.number}</span>}
            </div>
            {ticket ? (
              <>
                <p className="ticketcard__subject">{ticket.subject}</p>
                <p className="ticketcard__summary">{ticket.summary}</p>
                <dl className="kv">
                  <dt>Priority</dt>
                  <dd>
                    <span className={`prio prio--${ticket.priority}`}>{ticket.priority}</span>
                  </dd>
                  <dt>Status</dt>
                  <dd>{ticket.status}</dd>
                  <dt>Reason</dt>
                  <dd className="mono">{ticket.reason ?? "—"}</dd>
                  <dt>Notified</dt>
                  <dd>
                    <NotifyBadge status={ticket.notification_status} />
                  </dd>
                </dl>
              </>
            ) : (
              <p className="ticketcard__summary">This conversation was handed to a person.</p>
            )}
            <Link href={`/app/${slug}/tickets`} className="btn btn--ghost btn--sm">
              Open tickets
            </Link>
          </section>
        )}
        <section className="panel">
          <h2 className="engraved">How confidence is read</h2>
          <ul className="lamp-legend">
            <li>
              <Lamp level="green" size="md" label="none" /> <b>≥ {(threshold + 0.15).toFixed(2)}</b> confident
            </li>
            <li>
              <Lamp level="amber" size="md" label="none" /> <b>≥ {threshold.toFixed(2)}</b> answered, worth a look
            </li>
            <li>
              <Lamp level="red" size="md" label="none" /> <b>&lt; {threshold.toFixed(2)}</b> escalated to a human
            </li>
          </ul>
          <p className="hint">
            Complaints and requests for a person escalate at any confidence. The threshold is set in Settings.
          </p>
        </section>
      </aside>
    </div>
  );
}

function MessageItem({ m, threshold, slug }: { m: Message; threshold: number; slug: string }) {
  const prefix = `m${m.id}`;
  if (m.role === "user") {
    return (
      <li className="msg msg--user">
        <div className="msg__who">
          <span className="engraved">Visitor</span>
          <span className="msg__time">{timeAgo(m.created_at)}</span>
        </div>
        <div className="msg__body">
          <p>
            <RichText text={m.content} idPrefix={prefix} />
          </p>
          <div className="msg__meta">
            {m.intent && <span className="chip">{intentLabel(m.intent)}</span>}
            <RedactionBadges redactions={m.redactions} />
          </div>
        </div>
      </li>
    );
  }
  if (m.role === "human_agent") {
    return (
      <li className="msg msg--human">
        <div className="msg__who">
          <span className="engraved">{m.author_name ?? "Support agent"}</span>
          <span className="msg__time">{timeAgo(m.created_at)}</span>
        </div>
        <div className="msg__body">
          <p>{m.content}</p>
        </div>
      </li>
    );
  }
  return (
    <li className={`msg msg--ai${m.escalated ? " is-escalated" : ""}`}>
      <div className="msg__who">
        <span className="engraved">AI</span>
        <span className="msg__time">{timeAgo(m.created_at)}</span>
      </div>
      <div className="msg__body">
        <div className="msg__lampline">
          <Lamp confidence={m.confidence} threshold={threshold} size="md" />
          {m.escalated && <Alarm quiet>Escalated</Alarm>}
        </div>
        <p>
          <RichText text={m.content} idPrefix={prefix} citations={m.citations} />
        </p>
        <CitationList
          citations={m.citations}
          idPrefix={prefix}
          docHref={(c) => `/app/${slug}/documents#doc-${c.document_id}`}
        />
        {m.confidence_breakdown && (
          <details className="why">
            <summary>Why {m.confidence !== null ? m.confidence.toFixed(2) : "this score"}?</summary>
            <Breakdown breakdown={m.confidence_breakdown} confidence={m.confidence} />
          </details>
        )}
      </div>
    </li>
  );
}

function ReplyBox({ conversationId, onSent }: { conversationId: string; onSent: (m: Message) => void }) {
  const { tid } = useTenant();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="reply"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        setError(null);
        try {
          onSent(await api.reply(tid, conversationId, text.trim()));
          setText("");
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Reply not sent.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Reply as a human agent</span>
        <textarea
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write to the visitor. Your reply is saved to the conversation and the audit log."
        />
      </label>
      <div className="reply__row">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy || !text.trim()}>
          {busy ? "Sending…" : "Send reply"}
        </button>
      </div>
    </form>
  );
}
