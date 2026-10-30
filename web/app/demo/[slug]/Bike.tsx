/** Illustration of the fictional Northwind "Volt" e-bike. */
export function Bike() {
  const spokes = (cx: number, cy: number) =>
    Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * 62} y2={cy + Math.sin(a) * 62} />;
    });
  return (
    <svg viewBox="0 0 520 380" role="img" aria-label="Illustration of the Northwind Volt e-bike">
      <circle cx="300" cy="170" r="150" fill="#f4c430" />
      <ellipse cx="260" cy="338" rx="220" ry="14" fill="#0e1b1a" opacity="0.12" />
      <g fill="none" stroke="#0e1b1a" strokeLinecap="round" strokeLinejoin="round">
        {/* wheels */}
        <circle cx="130" cy="262" r="72" strokeWidth="12" />
        <circle cx="400" cy="262" r="72" strokeWidth="12" />
        <g strokeWidth="1.6" opacity="0.6">
          {spokes(130, 262)}
          {spokes(400, 262)}
        </g>
        <circle cx="130" cy="262" r="10" fill="#0e1b1a" />
        <circle cx="400" cy="262" r="16" fill="#0f7b6c" strokeWidth="5" />
        {/* frame */}
        <path d="M130 262 L218 140 L350 140 L255 262 Z" stroke="#0f7b6c" strokeWidth="14" />
        <path d="M130 262 L255 262" stroke="#0f7b6c" strokeWidth="12" />
        <path d="M350 140 L400 262" stroke="#0f7b6c" strokeWidth="12" />
        {/* battery on down tube */}
        <path d="M282 168 L248 216" stroke="#0e1b1a" strokeWidth="26" />
        <path d="M279 172 L262 196" stroke="#f4c430" strokeWidth="6" />
        {/* seat post + saddle */}
        <path d="M218 140 L204 100" strokeWidth="10" />
        <path d="M176 96 L234 96" strokeWidth="12" />
        {/* stem + bars */}
        <path d="M350 140 L338 84" strokeWidth="10" />
        <path d="M318 82 L370 78" strokeWidth="9" />
        {/* crank */}
        <circle cx="255" cy="262" r="18" strokeWidth="7" />
        <path d="M255 262 L275 292 M268 292 L288 292" strokeWidth="7" />
        {/* front light */}
        <path d="M356 104 L372 104" stroke="#0f7b6c" strokeWidth="10" />
      </g>
      <g fill="#0e1b1a" fontFamily="var(--nw-font), sans-serif" fontWeight="800">
        <text x="388" y="56" fontSize="14" letterSpacing="2">VOLT · 120 KM</text>
      </g>
    </svg>
  );
}
