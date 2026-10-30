export type LampLevel = "green" | "amber" | "red" | "off";

/** green ≥ threshold+0.15, amber ≥ threshold, red < threshold (escalated). */
export function lampLevel(confidence: number | null | undefined, threshold: number): LampLevel {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return "off";
  if (confidence >= threshold + 0.15) return "green";
  if (confidence >= threshold) return "amber";
  return "red";
}

export const LAMP_LABEL: Record<LampLevel, string> = {
  green: "Confident",
  amber: "Borderline",
  red: "Low",
  off: "No answer",
};

export function fmtConfidence(c: number | null | undefined): string {
  return c === null || c === undefined ? "—" : c.toFixed(2);
}
