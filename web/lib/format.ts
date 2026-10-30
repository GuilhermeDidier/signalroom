export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const INTENT_LABEL: Record<string, string> = {
  how_to: "How-to",
  billing: "Billing",
  account: "Account",
  bug_report: "Bug report",
  complaint: "Complaint",
  human_request: "Asked for human",
  out_of_scope: "Out of scope",
  smalltalk: "Small talk",
};

export const intentLabel = (i: string | null | undefined) => (i ? INTENT_LABEL[i] ?? i : "—");

export const pct = (x: number) => `${Math.round(x * 100)}%`;
