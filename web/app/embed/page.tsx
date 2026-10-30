import type { Metadata } from "next";
import { Suspense } from "react";
import { EmbedChat } from "./EmbedChat";

export const metadata: Metadata = { title: "Chat", robots: { index: false } };

export default function EmbedPage() {
  return (
    <Suspense fallback={<div className="embed" />}>
      <EmbedChat />
    </Suspense>
  );
}
