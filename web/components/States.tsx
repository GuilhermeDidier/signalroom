"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ApiError } from "@/lib/errors";
import type { Resource } from "@/lib/use-resource";

export function Loading({ label = "Loading", rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="state state--empty">
      <span className="state__lamp" aria-hidden="true" />
      <p className="state__title">{title}</p>
      {children && <p className="state__body">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorView({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const title =
    error.status === 403
      ? "Your role can't open this"
      : error.status === 404
        ? "Not found in this workspace"
        : error.status === 401
          ? "Your session ended"
          : "This didn't load";
  return (
    <div className="state state--error" role="alert">
      <span className="state__lamp state__lamp--red" aria-hidden="true" />
      <p className="state__title">{title}</p>
      <p className="state__body">{error.message}</p>
      {onRetry && error.status !== 403 && error.status !== 404 && (
        <button className="btn btn--ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Cold-start state. The hosted API sleeps on a free plan and takes ~50 s to
 * wake; poll /health and retry instead of failing.
 */
export function WakingUp({ onReady, compact = false }: { onReady: () => void; compact?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    let alive = true;
    const started = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    (async () => {
      while (alive && Date.now() - started < 120_000) {
        if (await api.health()) {
          if (alive) onReady();
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (alive) setGaveUp(true);
    })();
    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, [onReady]);
  const progress = Math.min(0.95, elapsed / 55);
  return (
    <div className={`waking${compact ? " waking--compact" : ""}`} role="status" aria-live="polite">
      <div className="waking__lamps" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`waking__dot${elapsed % 5 === i ? " is-on" : ""}`} />
        ))}
      </div>
      <p className="waking__title">{gaveUp ? "The backend is still asleep" : "Waking up the backend"}</p>
      <p className="waking__body">
        {gaveUp
          ? "It didn't answer within two minutes. Reload the page to try again."
          : "The demo API runs on a free host that sleeps when idle. The first request takes up to a minute — this page will continue on its own."}
      </p>
      {!gaveUp && (
        <div className="waking__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}
      <p className="waking__elapsed">{elapsed}s</p>
    </div>
  );
}

const noop = () => undefined;

/** Renders the right state for a resource, or children(data). */
export function View<T>({
  res,
  children,
  loadingRows,
  isEmpty,
  empty,
}: {
  res: Resource<T>;
  children: (data: T) => React.ReactNode;
  loadingRows?: number;
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
}) {
  if (res.error?.unreachable) return <WakingUp onReady={res.reload} />;
  if (res.error && !res.data) return <ErrorView error={res.error} onRetry={res.reload} />;
  if (res.data === null) return res.slow ? <WakingUp onReady={noop} /> : <Loading rows={loadingRows} />;
  if (isEmpty && isEmpty(res.data) && empty) return <>{empty}</>;
  return <>{children(res.data)}</>;
}
