import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/States";
import { Conversations } from "./Conversations";

export const metadata: Metadata = { title: "Conversations" };

export default function Page() {
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <Conversations />
    </Suspense>
  );
}
