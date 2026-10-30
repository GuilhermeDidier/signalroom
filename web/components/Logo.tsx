import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="Signalroom home">
      <span className="logo__lamps" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="logo__word">Signalroom</span>
    </Link>
  );
}
