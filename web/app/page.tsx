import Link from "next/link";
import { ArchDiagram } from "@/components/ArchDiagram";
import { Alarm, Lamp } from "@/components/Lamp";
import { Logo } from "@/components/Logo";
import s from "./landing.module.css";

const BOARD = [
  {
    q: "How should I store my battery over the winter?",
    a: "Indoors, 10–20 °C, at 40–60% charge [1]. Never charge it below 0 °C [1].",
    c: 0.94,
    cite: "Battery Care Guide.pdf · p.7",
  },
  {
    q: "Does the warranty cover the carbon fork if I crash?",
    a: "Forks are covered 2 years for defects [1]; crash damage may not qualify.",
    c: 0.66,
    cite: "Warranty Policy 2026.pdf · p.2",
  },
  {
    q: "Can I ride the Volt through a 40 cm river crossing?",
    a: "Nothing in the docs covers this, so it isn't guessing.",
    c: 0.15,
    cite: null,
  },
];

const PARTS = [
  ["Hybrid RAG with citations", "Vector + keyword search fused with RRF. Every claim points to a numbered source and snippet."],
  ["Confidence you can read", "A deterministic score from retrieval strength, citation coverage and the model's own check — shown as a lamp."],
  ["Agent with a human handoff", "Tool use to search, open tickets or hand off. Below the threshold it escalates instead of guessing."],
  ["PII redacted first", "Emails, phones, cards (Luhn), IBANs and more are replaced with placeholders before the model sees them."],
  ["Multi-tenant, role-based", "Every query is scoped to the workspace. Owners, admins and agents see what their role allows."],
  ["Audit log + embeddable widget", "Append-only log of every sensitive action. One script tag puts the chat on any site."],
] as const;

export default function Landing() {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <Logo />
        <span className={s.notice}>
          <span className={s.noticeDot} aria-hidden="true" />
          Demo · fictional companies, synthetic data
        </span>
        <Link href="/login" className={s.topLink}>
          Sign in
        </Link>
      </header>

      <main>
        <section className={s.hero}>
          <div className={s.pitch}>
            <p className="engraved">Multi-tenant AI support copilot</p>
            <h1 className={s.h1}>
              Every answer
              <br />
              lights a lamp.
            </h1>
            <p className={s.lede}>
              Signalroom answers your customers from your own help docs, cites where each answer came from, and
              scores how sure it is. When it isn&apos;t sure, it hands the conversation to a person and opens a ticket.
            </p>
            <div className={s.ctas}>
              <Link href="/demo/northwind" className="btn btn--lg">
                Try it as a customer
              </Link>
              <Link href="/login" className="btn btn--lg btn--ghost">
                Open the dashboard
              </Link>
            </div>
            <p className={s.ctaNote}>
              The customer view is a made-up e-bike shop with the real widget on it. The dashboard has one-click demo
              logins — no sign-up.
            </p>
          </div>

          <figure className={s.board} aria-label="Example answers with their confidence lamps">
            <figcaption className={s.boardHead}>
              <span className="engraved">Northwind Cycles · live answers</span>
              <span className={s.threshold}>
                threshold <b className="kbd-num">0.55</b>
              </span>
            </figcaption>
            <ol className={s.readouts}>
              {BOARD.map((r) => {
                const escalated = r.c < 0.55;
                return (
                  <li key={r.q} className={`${s.readout} ${escalated ? s.readoutAlarm : ""}`}>
                    <Lamp confidence={r.c} threshold={0.55} size="lg" label="none" className={s.readoutLamp} />
                    <div className={s.readoutBody}>
                      <p className={s.q}>“{r.q}”</p>
                      <p className={s.a}>{r.a}</p>
                      <div className={s.meta}>
                        <Lamp confidence={r.c} threshold={0.55} size="sm" />
                        {r.cite ? <span className={s.cite}>[1] {r.cite}</span> : null}
                        {escalated && <Alarm>Handed to a human · #1041</Alarm>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className={s.legend}>
              <span>
                <Lamp level="green" size="sm" label="none" /> ≥ threshold + 0.15
              </span>
              <span>
                <Lamp level="amber" size="sm" label="none" /> ≥ threshold
              </span>
              <span>
                <Lamp level="red" size="sm" label="none" /> below → escalate
              </span>
            </div>
          </figure>
        </section>

        <section className={s.lower} aria-labelledby="inside">
          <div className={s.parts}>
            <h2 id="inside" className="engraved">
              What&apos;s running behind the widget
            </h2>
            <dl className={s.partList}>
              {PARTS.map(([name, text]) => (
                <div key={name} className={s.part}>
                  <dt>{name}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className={`well ${s.archWell}`}>
            <h2 className="engraved">Architecture</h2>
            <ArchDiagram />
          </div>
        </section>
      </main>

      <footer className={s.foot}>
        <p>
          Portfolio demo. <strong>Northwind Cycles</strong> and <strong>Ledgerly</strong> are fictional companies; every
          document, conversation and ticket is synthetic. Don&apos;t type real personal data into the demo.
        </p>
      </footer>
    </div>
  );
}
