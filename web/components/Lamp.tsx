import { LAMP_LABEL, fmtConfidence, lampLevel, type LampLevel } from "@/lib/lamp";

interface LampProps {
  confidence?: number | null;
  threshold?: number;
  /** Force a level (e.g. decorative lamps on the landing page). */
  level?: LampLevel;
  size?: "sm" | "md" | "lg" | "xl";
  /** "full" = number + word, "number" = number only, "none" = lamp only (label kept for screen readers). */
  label?: "full" | "number" | "none";
  className?: string;
}

/**
 * The confidence lamp: a bezel-mounted indicator lens that glows green / amber /
 * red. Color is never the only signal — the reading and level word travel with it.
 */
export function Lamp({ confidence, threshold = 0.55, level, size = "md", label = "full", className = "" }: LampProps) {
  const lv = level ?? lampLevel(confidence, threshold);
  const reading = fmtConfidence(confidence);
  const word = LAMP_LABEL[lv];
  const a11y = confidence === null || confidence === undefined ? word : `Confidence ${reading}, ${word.toLowerCase()}`;
  return (
    <span className={`lamp lamp--${lv} lamp--${size} ${className}`} title={a11y}>
      <span className="lamp__bezel" aria-hidden="true">
        <span className="lamp__lens" />
      </span>
      {label === "none" ? (
        <span className="sr-only">{a11y}</span>
      ) : (
        <span className="lamp__text">
          {confidence !== null && confidence !== undefined && <span className="lamp__num">{reading}</span>}
          {label === "full" && <span className="lamp__word">{word}</span>}
          {label === "number" && <span className="sr-only">{word}</span>}
        </span>
      )}
    </span>
  );
}

/** Annunciator window: lights up for escalations. */
export function Alarm({ children, quiet = false }: { children: React.ReactNode; quiet?: boolean }) {
  return (
    <span className={`alarm${quiet ? " alarm--quiet" : ""}`} role="status">
      <span className="alarm__glyph" aria-hidden="true" />
      <span className="alarm__text">{children}</span>
    </span>
  );
}
