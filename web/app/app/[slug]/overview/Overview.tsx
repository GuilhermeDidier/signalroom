"use client";

import Link from "next/link";
import { useState } from "react";
import { RichText } from "@/components/Answer";
import { DailyChart } from "@/components/DailyChart";
import { Alarm, Lamp } from "@/components/Lamp";
import { Empty, View } from "@/components/States";
import { api } from "@/lib/api";
import { intentLabel, pct } from "@/lib/format";
import { useTenant } from "@/lib/tenant-context";
import type { Analytics } from "@/lib/types";
import { useResource } from "@/lib/use-resource";

const RANGES = [7, 14, 30] as const;

export function Overview() {
  const { tid, threshold, slug } = useTenant();
  const [days, setDays] = useState<number>(14);
  const res = useResource(() => api.analytics(tid, days), [tid, days]);

  return (
    <>
      <div className="toolbar">
        <p className="muted">How the assistant did over the last {days} days.</p>
        <div className="segmented" role="group" aria-label="Date range">
          {RANGES.map((d) => (
            <button key={d} className={d === days ? "is-on" : ""} aria-pressed={d === days} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <View
        res={res}
        loadingRows={8}
        isEmpty={(a: Analytics) => a.conversations === 0}
        empty={
          <div className="panel">
            <Empty
              title="No conversations yet"
              action={
                <Link className="btn" href={`/demo/${slug}`}>
                  Open the customer site
                </Link>
              }
            >
              Ask the widget a question on the demo site and the numbers will show up here.
            </Empty>
          </div>
        }
      >
        {(a) => <OverviewBody a={a} threshold={threshold} slug={slug} />}
      </View>
    </>
  );
}

function OverviewBody({ a, threshold, slug }: { a: Analytics; threshold: number; slug: string }) {
  const maxIntent = Math.max(1, ...a.by_intent.map((i) => i.count));
  const intents = [...a.by_intent].sort((x, y) => y.count - x.count);
  return (
    <>
      <section className="readout panel" aria-label="Key numbers">
        <div className="readout__hero well">
          <span className="engraved">Deflection rate</span>
          <p className="readout__big">
            {Math.round(a.deflection_rate * 100)}
            <span>%</span>
          </p>
          <p className="readout__caption">
            <b className="kbd-num">{a.ai_resolved.toLocaleString("en")}</b> of{" "}
            <b className="kbd-num">{a.conversations.toLocaleString("en")}</b> conversations answered by the AI without a
            human
          </p>
          <div className="splitbar" aria-hidden="true">
            <span className="splitbar__ok" style={{ flexGrow: a.ai_resolved }} />
            <span className="splitbar__esc" style={{ flexGrow: a.escalated }} />
          </div>
        </div>
        <dl className="meters">
          <div className="meter">
            <dt>Conversations</dt>
            <dd className="kbd-num">{a.conversations.toLocaleString("en")}</dd>
          </div>
          <div className="meter meter--alarm">
            <dt>Escalations</dt>
            <dd>
              <span className="kbd-num">{a.escalated.toLocaleString("en")}</span>
              {a.escalated > 0 && (
                <Link href={`/app/${slug}/conversations?filter=escalated`} className="meter__link">
                  <Alarm>{pct(a.escalated / Math.max(1, a.conversations))} to humans</Alarm>
                </Link>
              )}
            </dd>
          </div>
          <div className="meter">
            <dt>Low confidence</dt>
            <dd>
              <span className="kbd-num">{a.low_confidence.toLocaleString("en")}</span>
              <span className="meter__note">answers below {threshold.toFixed(2)}</span>
            </dd>
          </div>
          <div className="meter">
            <dt>Avg confidence</dt>
            <dd>
              <Lamp confidence={a.avg_confidence} threshold={threshold} size="lg" />
            </dd>
          </div>
        </dl>
      </section>

      <div className="split">
        <section className="panel" aria-labelledby="daily-h">
          <div className="panel__head">
            <h2 id="daily-h" className="engraved">Daily volume</h2>
          </div>
          <DailyChart daily={a.daily} />
        </section>
        <section className="panel" aria-labelledby="intent-h">
          <div className="panel__head">
            <h2 id="intent-h" className="engraved">By intent</h2>
          </div>
          {intents.length === 0 ? (
            <p className="muted">No intents recorded yet.</p>
          ) : (
            <ul className="bars">
              {intents.map((i) => (
                <li key={i.intent}>
                  <span className="bars__label">{intentLabel(i.intent)}</span>
                  <span className="bars__track">
                    <span
                      className={`bars__fill${i.intent === "complaint" || i.intent === "human_request" ? " bars__fill--hot" : ""}`}
                      style={{ width: `${(i.count / maxIntent) * 100}%` }}
                    />
                  </span>
                  <span className="bars__n kbd-num">{i.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel" aria-labelledby="unanswered-h">
        <div className="panel__head">
          <h2 id="unanswered-h" className="engraved">Top unanswered questions</h2>
          <span className="hint">Lowest-confidence questions — the gaps to fill in your docs.</span>
        </div>
        {a.top_unanswered.length === 0 ? (
          <Empty title="Nothing unanswered">Every question in this range had a confident answer.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {a.top_unanswered.map((q) => (
                  <tr key={q.question}>
                    <td>
                      <RichText text={q.question} idPrefix="q" />
                    </td>
                    <td className="cell-lamp">
                      <Lamp confidence={q.confidence} threshold={threshold} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
