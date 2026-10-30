"use client";

import Link from "next/link";
import { useState } from "react";

declare global {
  interface Window {
    Signalroom?: { open: () => void; close: () => void; toggle: () => void; ask: (text: string) => void };
  }
}

export function AskButtons({ questions, className }: { questions: { q: string; tag: string }[]; className: string }) {
  const [waiting, setWaiting] = useState(false);
  function ask(q: string, tries = 0) {
    if (window.Signalroom) {
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
