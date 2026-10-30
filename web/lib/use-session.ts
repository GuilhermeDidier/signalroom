"use client";

import { useSyncExternalStore } from "react";
import { getSession, subscribeSession } from "./session";
import type { LoginPayload } from "./types";

/** undefined = not known yet (server render / before hydration). */
export function useSession(): LoginPayload | null | undefined {
  return useSyncExternalStore(
    subscribeSession,
    () => getSession(),
    () => undefined,
  );
}
