"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RichText } from "@/components/Answer";
import { Lamp } from "@/components/Lamp";
import { WakingUp } from "@/components/States";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { LAMP_LABEL, lampLevel } from "@/lib/lamp";
import type { Citation, Redaction, WidgetConfig } from "@/lib/types";

interface UserMsg {
  kind: "user";
  id: string;
  text: string;
  redactions: Redaction[];
}
interface BotMsg {
  kind: "bot";
  id: string;
  text: string;
  streaming: boolean;
  confidence: number | null;
  citations: Citation[];
  escalate: boolean;
  ticketNumber: number | null;
  error: string | null;
}
type Msg = UserMsg | BotMsg;

function store(kind: "local" | "session") {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // storage blocked (third-party iframe, private mode)
  }
}

function persistentId(key: string): string {
  const name = `signalroom.visitor.${key}`;
  const s = store("local");
  try {
    const existing = s?.getItem(name);
    if (existing) return existing;
  } catch {
    // fall through to a fresh id
  }
  const id = `v_${crypto.getRandomValues(new Uint32Array(2)).reduce((a, n) => a + n.toString(16), "")}`;
  try {
    s?.setItem(name, id);
  } catch {
    // not persisted: a new id next visit, acceptable
  }
  return id;
}

const THRESHOLD_HINT = 0.55; // default threshold, for the lamp colour only

export function EmbedChat() {
  const params = useSearchParams();
  const key = params.get("key") ?? "";
  const hostParam = params.get("host");
  const hostOrigin = hostParam && /^https?:\/\/[^/]+$/.test(hostParam) ? hostParam : null;
  const inFrame = typeof window !== "undefined" && window.parent !== window;

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [configError, setConfigError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [asleep, setAsleep] = useState<string | null>(null); // pending text to resend after wake
  const conversationId = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const postParent = useCallback(
    (msg: Record<string, unknown>) => {
      if (window.parent !== window) window.parent.postMessage(msg, hostOrigin ?? "*");
    },
    [hostOrigin],
  );

  useEffect(() => {
    if (!key) return;
    let alive = true;
    api
      .widgetConfig(key)
      .then((c) => {
        if (!alive) return;
        setConfig(c);
        setConfigError(null);
        postParent({ type: "signalroom:config", brand_color: c.brand_color, tenant_name: c.tenant_name });
      })
      .catch((e: unknown) => alive && setConfigError(e instanceof ApiError ? e : new ApiError(-1, "Chat unavailable.")));
    try {
      conversationId.current = store("session")?.getItem(`signalroom.conv.${key}`) ?? undefined;
    } catch {
      conversationId.current = undefined;
    }
    return () => {
      alive = false;
    };
  }, [key, attempt, postParent]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [msgs]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, 2000);
      if (!text || busy || !key) return;
      setBusy(true);
      setInput("");
      const uid = `u${Date.now()}`;
      const bid = `b${Date.now()}`;
      setMsgs((m) => [
        ...m,
        { kind: "user", id: uid, text, redactions: [] },
        { kind: "bot", id: bid, text: "", streaming: true, confidence: null, citations: [], escalate: false, ticketNumber: null, error: null },
      ]);
      const patchBot = (fn: (b: BotMsg) => BotMsg) =>
        setMsgs((m) => m.map((x) => (x.id === bid && x.kind === "bot" ? fn(x) : x)));
      const ctrl = new AbortController();
      try {
        const visitor_id = persistentId(key);
        for await (const ev of api.widgetChat({ key, visitor_id, message: text, conversation_id: conversationId.current }, ctrl.signal)) {
          if (ev.event === "meta") {
            setMsgs((m) =>
              m.map((x) =>
                x.id === uid && x.kind === "user" ? { ...x, text: ev.data.redacted_message, redactions: ev.data.redactions ?? [] } : x,
              ),
            );
          } else if (ev.event === "token") {
            patchBot((b) => ({ ...b, text: b.text + ev.data.text }));
          } else if (ev.event === "done") {
            patchBot((b) => ({
              ...b,
              text: ev.data.answer || b.text,
              confidence: Number(ev.data.confidence),
              citations: ev.data.citations ?? [],
              escalate: Boolean(ev.data.escalate),
            }));
          } else if (ev.event === "saved") {
            conversationId.current = ev.data.conversation_id;
            try {
              store("session")?.setItem(`signalroom.conv.${key}`, ev.data.conversation_id);
            } catch {
              // conversation continues in memory only
            }
            patchBot((b) => ({ ...b, ticketNumber: ev.data.ticket?.number ?? null }));
          } else if (ev.event === "error") {
            patchBot((b) => ({ ...b, error: ev.data.message || "The assistant hit an error." }));
          }
        }
        patchBot((b) => ({ ...b, streaming: false }));
      } catch (e) {
        if (e instanceof ApiError && e.unreachable) {
          setMsgs((m) => m.filter((x) => x.id !== uid && x.id !== bid));
          setAsleep(text);
        } else {
          const msg =
            e instanceof ApiError && e.status === 429
              ? "You've sent a lot of messages. Please wait a bit and try again."
              : e instanceof Error
                ? e.message
                : "Message not sent.";
          patchBot((b) => ({ ...b, streaming: false, error: msg }));
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, key],
  );

  // Messages from the host page (widget.js): open → focus, ask → send.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window.parent) return;
      if (hostOrigin && e.origin !== hostOrigin) return;
      const d = (e.data ?? {}) as { type?: string; text?: string };
      if (d.type === "signalroom:open") inputRef.current?.focus();
      if (d.type === "signalroom:ask" && typeof d.text === "string") sendRef.current(d.text);
    }
    window.addEventListener("message", onMessage);
    postParent({ type: "signalroom:ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [hostOrigin, postParent]);

  const brand = config && /^#[0-9a-fA-F]{6}$/.test(config.brand_color) ? config.brand_color : "#1f5fd1";
  const blockedHost = config && inFrame ? disallowedHost(config.allowed_origins, hostOrigin) : null;

  if (!key) {
    return (
      <div className="embed embed--center">
        <p className="state__title">Missing widget key</p>
        <p className="muted">Load this page through widget.js with a data-key attribute.</p>
      </div>
    );
  }

  return (
    <div className="embed" style={{ ["--brand" as string]: brand }}>
      <header className="embed__head">
        <div className="embed__id">
          <span className="embed__avatar" aria-hidden="true">
            {(config?.tenant_name ?? "S").slice(0, 1)}
          </span>
          <div>
            <p className="embed__name">{config?.tenant_name ?? "Support"}</p>
            <p className="embed__sub">AI assistant · answers cite our help articles</p>
          </div>
        </div>
        {inFrame && (
          <button className="embed__close" aria-label="Close chat" onClick={() => postParent({ type: "signalroom:close" })}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </header>
      <p className="embed__pii">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M8 1.5 2.5 3.5v4c0 3.3 2.3 6 5.5 7 3.2-1 5.5-3.7 5.5-7v-4z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        We hide personal data (emails, phone and card numbers) before the AI sees your message.
      </p>

      <div className="embed__scroll">
        {blockedHost ? (
          <div className="embed--center">
            <p className="state__title">Chat isn&apos;t enabled on this site</p>
            <p className="muted">
              {blockedHost} isn&apos;t in this workspace&apos;s allowed origins. The owner can add it under Settings.
            </p>
          </div>
        ) : configError && !config ? (
          configError.unreachable ? (
            <WakingUp compact onReady={() => setAttempt((n) => n + 1)} />
          ) : (
            <div className="embed--center">
              <p className="state__title">Chat unavailable</p>
              <p className="muted">{configError.message}</p>
            </div>
          )
        ) : (
          <ol className="embed__msgs" ref={listRef} aria-live="polite">
            <li className="bubble bubble--bot">
              <p>{config ? config.greeting : "Connecting…"}</p>
            </li>
            {msgs.map((m) => (m.kind === "user" ? <UserBubble key={m.id} m={m} /> : <BotBubble key={m.id} m={m} />))}
          </ol>
        )}
        {asleep && (
          <WakingUp
            compact
            onReady={() => {
              const text = asleep;
              setAsleep(null);
              send(text);
            }}
          />
        )}
      </div>

      <form
        className="embed__composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="embed-input" className="sr-only">
          Your question
        </label>
        <textarea
          id="embed-input"
          ref={inputRef}
          className="embed__input"
          rows={1}
          maxLength={2000}
          placeholder="Ask a question…"
          value={input}
          disabled={!config}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
            if (e.key === "Escape" && inFrame) postParent({ type: "signalroom:close" });
          }}
        />
        <button className="embed__send" type="submit" disabled={busy || !input.trim() || !config} aria-label="Send">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M4 12l16-8-6 16-2.5-6.5z" fill="currentColor" />
          </svg>
        </button>
      </form>
      <p className="embed__foot">
        Powered by <b>Signalroom</b> · demo with fictional data
      </p>
    </div>
  );
}

/**
 * Courtesy check of the embedding page against allowed_origins. It's UX, not a
 * security boundary: a publishable key can be used from anywhere, which is why
 * the API rate-limits per visitor. The Signalroom origin itself (demo pages) is always allowed.
 */
function disallowedHost(allowed: string[] | undefined, hostParam: string | null): string | null {
  if (!allowed || allowed.length === 0) return null;
  let host: string | null = null;
  try {
    host = window.location.ancestorOrigins?.[0] ?? (document.referrer ? new URL(document.referrer).origin : hostParam);
  } catch {
    host = hostParam;
  }
  if (!host || host === window.location.origin) return null;
  const norm = (o: string) => o.trim().replace(/\/$/, "").toLowerCase();
  return allowed.map(norm).includes(norm(host)) ? null : host;
}

function UserBubble({ m }: { m: UserMsg }) {
  return (
    <li className="bubble bubble--user">
      <p>
        <RichText text={m.text} idPrefix={m.id} />
      </p>
      {m.redactions.length > 0 && (
        <p className="bubble__redacted">
          Hidden from the AI: {m.redactions.map((r) => `${r.type.toLowerCase()}${r.count > 1 ? ` ×${r.count}` : ""}`).join(", ")}
        </p>
      )}
    </li>
  );
}

function BotBubble({ m }: { m: BotMsg }) {
  const [open, setOpen] = useState<number | null>(null);
  // The widget doesn't know the tenant threshold; an answer that wasn't escalated passed it, so it is never red.
  const raw = lampLevel(m.confidence, THRESHOLD_HINT);
  const lampLevelFinal = !m.escalate && raw === "red" ? "amber" : raw;
  return (
    <li className={`bubble bubble--bot${m.escalate ? " is-escalated" : ""}`}>
      {m.text ? (
        <p>
          <RichText text={m.text} idPrefix={m.id} citations={m.citations} />
          {m.streaming && !m.confidence && <span className="caret" aria-hidden="true" />}
        </p>
      ) : m.error ? null : (
        <p className="typing" aria-label="Assistant is typing">
          <span />
          <span />
          <span />
        </p>
      )}
      {m.error && <p className="bubble__error">{m.error}</p>}
      {m.citations.length > 0 && (
        <div className="cchips">
          {m.citations.map((c) => (
            <button
              key={c.n}
              type="button"
              className={`cchip${open === c.n ? " is-open" : ""}`}
              aria-expanded={open === c.n}
              onClick={() => setOpen(open === c.n ? null : c.n)}
            >
              <span className="cchip__n">{c.n}</span>
              <span className="cchip__t">
                {c.document_title}
                {c.heading ? ` · ${c.heading}` : ""}
              </span>
            </button>
          ))}
          {m.citations
            .filter((c) => c.n === open)
            .map((c) => (
              <blockquote key={c.n} className="cchip__snippet">
                <span className="cchip__where">
                  {c.document_title}
                  {c.heading ? ` · ${c.heading}` : ""}
                  {c.page ? ` · p.${c.page}` : ""}
                </span>
                {c.snippet}
              </blockquote>
            ))}
        </div>
      )}
      {m.confidence !== null && (
        <div className="bubble__lamp">
          <Lamp confidence={m.confidence} level={lampLevelFinal} size="sm" label="number" />
          <span>{m.escalate ? "Handing over to a person" : `${LAMP_LABEL[lampLevelFinal]} answer`}</span>
        </div>
      )}
      {m.escalate && (
        <div className="handoff" role="status">
          <span className="handoff__lamp" aria-hidden="true" />
          <div>
            <p className="handoff__title">Connecting you with a human</p>
            <p className="handoff__body">
              {m.ticketNumber ? (
                <>
                  Ticket <b>#{m.ticketNumber}</b> created. A support agent will pick up this conversation.
                </>
              ) : m.streaming ? (
                "Opening a ticket…"
              ) : (
                "A support agent will pick up this conversation."
              )}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}
