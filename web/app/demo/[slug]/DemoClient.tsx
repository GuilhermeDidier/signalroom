"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    Signalroom?: {
      key: string;
      open: () => void;
      close: () => void;
      toggle: () => void;
      ask: (text: string) => void;
      destroy: () => void;
    };
  }
}

/**
 * The embed a customer pastes (`<script src="/widget.js" data-key=… async>`), added
 * from an effect so it follows client-side navigation: React 19 dedupes a rendered
 * async script by src and never re-runs or removes it, so moving from one demo to the
 * other kept the first tenant's widget. Leaving the page removes the widget.
 */
export function WidgetEmbed({ widgetKey }: { widgetKey: string }) {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.async = true;
    script.dataset.key = widgetKey;
    document.body.appendChild(script);
    return () => {
      script.remove(); // a widget.js that has not run yet then mounts nothing
      if (window.Signalroom?.key === widgetKey) window.Signalroom.destroy();
    };
  }, [widgetKey]);
  return null;
}

export function AskButtons({
  questions,
  className,
  widgetKey,
}: {
  questions: { q: string; tag: string }[];
  className: string;
  widgetKey: string;
}) {
  const [waiting, setWaiting] = useState(false);
  function ask(q: string, tries = 0) {
    // Only this page's tenant widget: never ask a widget left over from another page.
    if (window.Signalroom?.key === widgetKey) {
      setWaiting(false);
      window.Signalroom.ask(q);
    } else if (tries < 40) {
      setWaiting(true);
      setTimeout(() => ask(q, tries + 1), 250);
    }
  }
  return (
    <>
      <ul className={className}>
        {questions.map(({ q, tag }) => (
          <li key={q}>
            <button type="button" onClick={() => ask(q)}>
              <span>{q}</span>
              <small>{tag}</small>
            </button>
          </li>
        ))}
      </ul>
      {waiting && <p role="status">Loading the chat widget…</p>}
    </>
  );
}

export function DemoHint({ slug }: { slug: string }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <aside className="demohint" aria-label="About this page">
      <span className="demohint__lamps" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <p>
        <b>This is a fictional company site.</b> The chat bubble is the Signalroom widget.{" "}
        <Link href="/login">See it from the dashboard</Link> ·{" "}
        <Link href={slug === "northwind" ? "/demo/ledgerly" : "/demo/northwind"}>
          {slug === "northwind" ? "Try Ledgerly" : "Try Northwind"}
        </Link>
      </p>
      <button type="button" onClick={() => setHidden(true)} aria-label="Hide this note">
        ×
      </button>
    </aside>
  );
}
