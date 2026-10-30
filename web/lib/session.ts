import type { LoginPayload, Me } from "./types";

/**
 * Session storage for the JWT.
 *
 * Trade-off: the token lives in memory and is mirrored to sessionStorage so a
 * reload keeps you signed in, while closing the tab signs you out. That is
 * readable by any script on this origin (an XSS would leak it), which an
 * httpOnly cookie would avoid — but the API is on a different origin and is
 * called with `Authorization: Bearer`, and the demo has no third-party
 * scripts. sessionStorage (not localStorage) limits the token's lifetime to
 * the tab. For production: httpOnly, SameSite cookie set by the API.
 */
const KEY = "signalroom.session";

let memory: LoginPayload | null = null;
const listeners = new Set<() => void>();

export function getSession(): LoginPayload | null {
  if (memory) return memory;
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(KEY) : null;
    if (raw) memory = JSON.parse(raw) as LoginPayload;
  } catch {
    memory = null; // storage blocked or corrupted: treat as signed out
  }
  return memory;
}

export function setSession(payload: LoginPayload | null): void {
  memory = payload;
  try {
    if (payload) window.sessionStorage.setItem(KEY, JSON.stringify(payload));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: the in-memory copy still works for this page view
  }
  listeners.forEach((fn) => fn());
}

export function updateSessionMe(me: Me): void {
  const current = getSession();
  if (current) setSession({ ...current, ...me });
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}
