"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./errors";

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True once a request has been pending long enough to suggest a cold start. */
  slow: boolean;
  reload: () => void;
  setData: (fn: (prev: T | null) => T | null) => void;
}

const SLOW_MS = 3500;

interface Settled<T> {
  key: string;
  depsKey: string;
  data: T | null;
  error: ApiError | null;
}

/**
 * Fetch-on-mount with loading / error / slow (cold start) states.
 * `deps` must be JSON-serializable; data is kept across reloads of the same deps.
 */
export function useResource<T>(fetcher: (() => Promise<T>) | null, deps: unknown[]): Resource<T> {
  const [nonce, setNonce] = useState(0);
  const depsKey = JSON.stringify(deps);
  const key = `${depsKey}#${nonce}`;
  const [settled, setSettled] = useState<Settled<T>>({ key: "", depsKey: "", data: null, error: null });
  const [slowKey, setSlowKey] = useState("");

  useEffect(() => {
    if (!fetcher) return;
    let cancelled = false;
    const timer = setTimeout(() => !cancelled && setSlowKey(key), SLOW_MS);
    fetcher()
      .then((data) => {
        if (!cancelled) setSettled({ key, depsKey, data, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const error = e instanceof ApiError ? e : new ApiError(-1, e instanceof Error ? e.message : String(e));
        setSettled((prev) => ({ key, depsKey, data: prev.depsKey === depsKey ? prev.data : null, error }));
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The fetcher closure changes every render; `key` captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = settled.key !== key;
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback(
    (fn: (prev: T | null) => T | null) => setSettled((prev) => ({ ...prev, data: fn(prev.data) })),
    [],
  );
  return {
    data: settled.depsKey === depsKey ? settled.data : null,
    error: settled.key === key ? settled.error : null,
    loading,
    slow: loading && slowKey === key,
    reload,
    setData,
  };
}
