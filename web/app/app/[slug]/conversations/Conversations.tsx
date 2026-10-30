"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RichText } from "@/components/Answer";
import { Alarm, Lamp } from "@/components/Lamp";
import { Empty, View } from "@/components/States";
import { api, type ConversationFilter } from "@/lib/api";
import { intentLabel, timeAgo } from "@/lib/format";
import { useTenant } from "@/lib/tenant-context";
import { useResource } from "@/lib/use-resource";

const FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "low_confidence", label: "Low confidence" },
  { id: "escalated", label: "Escalated" },
];

export function Conversations() {
  const { tid, slug, threshold } = useTenant();
  const params = useSearchParams();
  const router = useRouter();
  const raw = params.get("filter");
  const filter: ConversationFilter = raw === "low_confidence" || raw === "escalated" ? raw : "all";
  const res = useResource(() => api.conversations(tid, filter), [tid, filter]);

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter conversations">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={f.id === filter ? "is-on" : ""}
              aria-pressed={f.id === filter}
              onClick={() => router.replace(f.id === "all" ? `/app/${slug}/conversations` : `?filter=${f.id}`)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="hint">
          Lamps: green ≥ {(threshold + 0.15).toFixed(2)} · amber ≥ {threshold.toFixed(2)} · red below → escalated
        </p>
      </div>
      <section className="panel panel--flush">
        <View
          res={res}
          loadingRows={7}
          isEmpty={(d) => d.length === 0}
          empty={
            <Empty
              title={filter === "all" ? "No conversations yet" : "Nothing matches this filter"}
              action={
                filter === "all" ? (
                  <Link className="btn" href={`/demo/${slug}`}>
                    Ask the widget a question
                  </Link>
                ) : undefined
              }
            >
              {filter === "all"
                ? "Conversations from the website widget show up here as they happen."
                : "No conversations in this view right now."}
            </Empty>
          }
        >
          {(list) => (
            <ul className="convlist">
              {list.map((c) => {
                const escalated = c.status === "escalated";
                return (
                  <li key={c.id}>
                    <Link href={`/app/${slug}/conversations/${c.id}`} className={`convrow${escalated ? " is-alarm" : ""}`}>
                      <Lamp confidence={c.confidence} threshold={threshold} size="lg" label="none" className="convrow__lamp" />
                      <span className="convrow__main">
                        <span className="convrow__q">
                          {c.first_message ? <RichText text={c.first_message} idPrefix={c.id} /> : "(no message)"}
                        </span>
                        <span className="convrow__sub">
                          <span className="mono">{c.visitor_id ?? "visitor"}</span> · {timeAgo(c.last_message_at)}
                          {c.message_count ? ` · ${c.message_count} messages` : ""}
                        </span>
                      </span>
                      <span className="convrow__intent">
                        <span className="chip">{intentLabel(c.intent)}</span>
                      </span>
                      <span className="convrow__conf">
                        <Lamp confidence={c.confidence} threshold={threshold} size="sm" />
                      </span>
                      <span className="convrow__status">
                        {escalated ? (
                          <Alarm>Escalated{c.ticket ? ` · #${c.ticket.number}` : ""}</Alarm>
                        ) : (
                          <span className={`chip ${c.status === "resolved" ? "chip--green" : "chip--blue"}`}>
                            {c.status === "resolved" ? "Resolved" : "Open"}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </View>
      </section>
    </>
  );
}
