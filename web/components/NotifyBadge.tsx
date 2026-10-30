export function NotifyBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    sent: ["chip--green", "n8n sent"],
    skipped: ["", "skipped"],
    failed: ["chip--red", "failed"],
    pending: ["chip--amber", "pending"],
  };
  const [cls, label] = map[status] ?? ["", status];
  return <span className={`chip ${cls}`}>{label}</span>;
}
