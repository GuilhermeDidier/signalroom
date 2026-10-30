interface Node {
  id: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sub: string;
  tone?: "core" | "store" | "edge";
}
interface Edge {
  d: string;
  label: string;
  lx: number;
  ly: number;
  anchor?: "start" | "middle" | "end";
  dashed?: boolean;
}

const H = 54;

const wide: { w: number; h: number; nodes: Node[]; edges: Edge[] } = {
  w: 930,
  h: 260,
  nodes: [
    { id: "host", x: 10, y: 30, w: 150, title: "Customer site", sub: "widget.js → iframe", tone: "edge" },
    { id: "web", x: 230, y: 30, w: 150, title: "web", sub: "Next.js · dashboard" },
    { id: "api", x: 460, y: 30, w: 160, title: "api", sub: "NestJS · auth · RBAC", tone: "core" },
    { id: "ai", x: 730, y: 30, w: 180, title: "ai", sub: "FastAPI · RAG · agent", tone: "core" },
    { id: "n8n", x: 230, y: 190, w: 150, title: "n8n", sub: "ticket alerts", tone: "edge" },
    { id: "redis", x: 460, y: 190, w: 160, title: "Redis · BullMQ", sub: "ingest jobs", tone: "store" },
    { id: "pg", x: 720, y: 190, w: 200, title: "Postgres + pgvector", sub: "tenant-scoped rows", tone: "store" },
  ],
  edges: [
    { d: "M160 57 H224", label: "embed", lx: 192, ly: 49 },
    { d: "M380 57 H454", label: "HTTP · SSE", lx: 417, ly: 49 },
    { d: "M620 57 H724", label: "internal token", lx: 672, ly: 49 },
    { d: "M500 84 V184", label: "queue", lx: 494, ly: 140, anchor: "end" },
    { d: "M620 205 C 670 205, 720 150, 760 90", label: "worker → /ingest", lx: 690, ly: 165, anchor: "end", dashed: true },
    { d: "M600 84 C 640 120, 690 160, 740 186", label: "", lx: 0, ly: 0 },
    { d: "M860 84 V184", label: "hybrid search", lx: 852, ly: 140, anchor: "end" },
    { d: "M470 84 C 440 140, 360 150, 330 184", label: "webhook · HMAC", lx: 400, ly: 128, anchor: "end" },
  ],
};

const tall: typeof wide = {
  w: 360,
  h: 560,
  nodes: [
    { id: "host", x: 10, y: 10, w: 160, title: "Customer site", sub: "widget.js → iframe", tone: "edge" },
    { id: "web", x: 190, y: 10, w: 160, title: "web", sub: "Next.js · dashboard" },
    { id: "api", x: 100, y: 140, w: 160, title: "api", sub: "NestJS · auth · RBAC", tone: "core" },
    { id: "n8n", x: 10, y: 270, w: 140, title: "n8n", sub: "ticket alerts", tone: "edge" },
    { id: "redis", x: 210, y: 270, w: 140, title: "Redis · BullMQ", sub: "ingest jobs", tone: "store" },
    { id: "ai", x: 90, y: 390, w: 180, title: "ai", sub: "FastAPI · RAG · agent", tone: "core" },
    { id: "pg", x: 80, y: 496, w: 200, title: "Postgres + pgvector", sub: "tenant-scoped rows", tone: "store" },
  ],
  edges: [
    { d: "M170 37 H184", label: "", lx: 0, ly: 0 },
    { d: "M270 64 V100 L215 134", label: "HTTP · SSE", lx: 276, ly: 106, anchor: "start" },
    { d: "M130 194 L90 264", label: "webhook", lx: 100, ly: 226, anchor: "end" },
    { d: "M230 194 L270 264", label: "queue", lx: 260, ly: 226, anchor: "start" },
    { d: "M170 194 V384", label: "internal token", lx: 164, ly: 300, anchor: "end", dashed: false },
    { d: "M280 324 L250 384", label: "/ingest", lx: 272, ly: 362, anchor: "start", dashed: true },
    { d: "M180 444 V490", label: "hybrid search", lx: 186, ly: 472, anchor: "start" },
  ],
};

function Diagram({ spec, className }: { spec: typeof wide; className: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${spec.w} ${spec.h}`}
      role="img"
      aria-labelledby={`arch-title-${spec.w}`}
    >
      <title id={`arch-title-${spec.w}`}>
        Architecture: the widget and dashboard call the NestJS api over HTTP and SSE. The api calls the FastAPI ai
        service with an internal token, queues ingest jobs in Redis with BullMQ, sends ticket alerts to n8n with an
        HMAC signature, and both services use Postgres with pgvector.
      </title>
      <defs>
        <marker id={`arrow-${spec.w}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="#5d6f84" />
        </marker>
      </defs>
      {spec.edges.map((e, i) => (
        <g key={i}>
          <path d={e.d} fill="none" stroke="#7d8da0" strokeWidth="1.6" markerEnd={`url(#arrow-${spec.w})`} strokeDasharray={e.dashed ? "5 4" : undefined} />
          {e.label && (
            <text x={e.lx} y={e.ly} textAnchor={e.anchor ?? "middle"} className="arch__edge">
              {e.label}
            </text>
          )}
        </g>
      ))}
      {spec.nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x} ${n.y})`} className={`arch__node arch__node--${n.tone ?? "plain"}`}>
          <rect width={n.w} height={H} rx="8" />
          <circle cx="14" cy="18" r="4" className="arch__led" />
          <text x="26" y="23" className="arch__title">
            {n.title}
          </text>
          <text x="14" y="42" className="arch__sub">
            {n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function ArchDiagram() {
  return (
    <div className="arch">
      <Diagram spec={wide} className="arch__svg arch__svg--wide" />
      <Diagram spec={tall} className="arch__svg arch__svg--tall" />
    </div>
  );
}
