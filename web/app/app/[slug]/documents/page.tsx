import type { Metadata } from "next";
import { Documents } from "./Documents";

export const metadata: Metadata = { title: "Documents" };

export default function Page() {
  return <Documents />;
}
