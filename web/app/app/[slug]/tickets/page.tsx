import type { Metadata } from "next";
import { Tickets } from "./Tickets";

export const metadata: Metadata = { title: "Tickets" };

export default function Page() {
  return <Tickets />;
}
