import type { Metadata } from "next";
import { Audit } from "./Audit";

export const metadata: Metadata = { title: "Audit" };

export default function Page() {
  return <Audit />;
}
