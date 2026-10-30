import type { Metadata } from "next";
import { ConversationView } from "./ConversationView";

export const metadata: Metadata = { title: "Conversation" };

export default function Page() {
  return <ConversationView />;
}
