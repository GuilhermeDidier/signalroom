import type { Metadata } from "next";
import { Suspense } from "react";
import { AcceptInvite } from "./AcceptInvite";

export const metadata: Metadata = { title: "Accept invite" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AcceptInvite />
    </Suspense>
  );
}
