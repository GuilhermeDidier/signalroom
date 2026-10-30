"use client";

import { Fragment } from "react";
import type { Citation, Redaction } from "@/lib/types";

const TOKEN = /(\[(?:EMAIL|PHONE|CARD|SSN|IBAN|IP)_\d+\]|\[\d{1,2}\])/g;

/**
 * Renders message text with citation markers ([1]) as links to the citation
 * list and PII placeholders ([EMAIL_1]) highlighted.
 */
export function RichText({ text, idPrefix, citations = [] }: { text: string; idPrefix: string; citations?: Citation[] }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\[\d{1,2}\]$/.test(p)) {
          const n = Number(p.slice(1, -1));
          const c = citations.find((x) => x.n === n);
          if (!c) return <Fragment key={i}>{p}</Fragment>;
          return (
            <a key={i} className="cite-mark" href={`#${idPrefix}-cite-${n}`} title={c.document_title}>
              {n}
            </a>
          );
        }
        if (/^\[[A-Z]+_\d+\]$/.test(p)) {
          return (
            <mark key={i} className="pii" title="Personal data hidden before the AI saw this message">
              {p}
            </mark>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

export function RedactionBadges({ redactions }: { redactions: Redaction[] }) {
  if (!redactions.length) return null;
  return (
    <span className="redactions">
      <span className="redactions__label">PII hidden</span>
      {redactions.map((r) => (
        <span key={r.type} className="chip chip--pii">
          {r.type}
          {r.count > 1 ? ` ×${r.count}` : ""}
        </span>
      ))}
    </span>
  );
}

export function CitationList({
  citations,
  idPrefix,
  docHref,
}: {
  citations: Citation[];
  idPrefix: string;
  docHref?: (c: Citation) => string;
}) {
  if (!citations.length) return null;
  return (
    <ol className="citations">
      {citations.map((c) => (
        <li key={c.n} id={`${idPrefix}-cite-${c.n}`} className="citation">
          <details>
            <summary>
              <span className="citation__n">{c.n}</span>
              <span className="citation__title">
                {docHref ? <a href={docHref(c)}>{c.document_title}</a> : c.document_title}
              </span>
              <span className="citation__where">
                {[c.heading, c.page ? `p.${c.page}` : null].filter(Boolean).join(" · ")}
              </span>
            </summary>
            <blockquote className="citation__snippet">{c.snippet}</blockquote>
          </details>
        </li>
      ))}
    </ol>
  );
}

const CAP_LABEL: Record<string, string> = {
  not_answerable: "Capped at 0.30: the model said it can't answer from the docs.",
  uncited: "Capped at 0.35: the answer cites no source.",
};

function Bar({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="breakdown__row">
      <span className="breakdown__k">{label}</span>
      <span className="breakdown__track" aria-hidden="true">
        <span style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </span>
      <span className="breakdown__v kbd-num">{value.toFixed(2)}</span>
      {note && <span className="breakdown__note">{note}</span>}
    </div>
  );
}

const n = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

/**
 * The three signals of the ai service's confidence formula
 * (retrieval strength, citation coverage, the model's answerable flag) plus any cap.
 */
export function Breakdown({ breakdown: b, confidence }: { breakdown: Record<string, unknown>; confidence: number | null }) {
  if (b.mode === "no_kb") {
    return (
      <div className="breakdown">
        <p className="hint">Small talk or an out-of-scope reply: no knowledge-base search, so the score is fixed.</p>
        {confidence !== null && (
          <p className="breakdown__total">
            confidence <b className="kbd-num">{confidence.toFixed(2)}</b>
          </p>
        )}
      </div>
    );
  }
  const r = n(b.retrieval_strength);
  const c = n(b.citation_coverage);
  const a = n(b.answerable_score);
  const cos = n(b.top_cited_cosine);
  const claims = n(b.claim_sentences);
  const cited = n(b.cited_sentences);
  const cap = typeof b.cap_applied === "string" ? b.cap_applied : null;
  return (
    <div className="breakdown">
      {r !== null && <Bar label="Retrieval strength" value={r} note={cos !== null ? `best cited match, cosine ${cos.toFixed(2)}` : undefined} />}
      {c !== null && (
        <Bar label="Citation coverage" value={c} note={claims !== null && cited !== null ? `${cited} of ${claims} claims cite a source` : undefined} />
      )}
      {a !== null && (
        <Bar label="Model says answerable" value={a} note={typeof b.answerable === "string" ? `flag: ${b.answerable}` : undefined} />
      )}
      {cap && <p className="breakdown__cap">{CAP_LABEL[cap] ?? `Cap applied: ${cap}`}</p>}
      {confidence !== null && (
        <p className="breakdown__total">
          = confidence <b className="kbd-num">{confidence.toFixed(2)}</b>
        </p>
      )}
    </div>
  );
}
