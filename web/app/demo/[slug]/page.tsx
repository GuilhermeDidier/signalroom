import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Archivo, Sora } from "next/font/google";
import { DEMO_WIDGET_KEYS } from "@/lib/config";
import { AskButtons, DemoHint } from "./DemoClient";
import { Bike } from "./Bike";
import s from "./demo.module.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--nw-font" });
const sora = Sora({ subsets: ["latin"], variable: "--lg-font" });

const SLUGS = ["northwind", "ledgerly"] as const;
type Slug = (typeof SLUGS)[number];

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/demo/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug === "ledgerly" ? "Ledgerly (fictional demo)" : "Northwind Cycles (fictional demo)" };
}

const QUESTIONS: Record<Slug, { q: string; tag: string }[]> = {
  northwind: [
    { q: "How should I store my battery over the winter?", tag: "Answered from docs" },
    { q: "What's your return window if I change my mind?", tag: "Answered from docs" },
    { q: "Can I ride my Volt through a 40 cm deep river?", tag: "Not in docs → human" },
    { q: "Has my order shipped? My email is jane.doe@example.com", tag: "Contains PII" },
  ],
  ledgerly: [
    { q: "If I upgrade to Scale mid-month, do I pay the full price?", tag: "Answered from docs" },
    { q: "How do I set up SSO with Okta?", tag: "Answered from docs" },
    { q: "Do you support Xero two-way sync?", tag: "Not in docs → human" },
    { q: "I was charged twice on card 4242 4242 4242 4242, call me at +1 415 555 0100", tag: "Contains PII" },
  ],
};

export default async function DemoSite({ params }: PageProps<"/demo/[slug]">) {
  const { slug } = await params;
  if (!SLUGS.includes(slug as Slug)) notFound();
  const key = DEMO_WIDGET_KEYS[slug];
  const site = slug as Slug;
  return (
    <>
      {site === "northwind" ? <Northwind /> : <Ledgerly />}
      <section className={site === "northwind" ? `${archivo.variable} ${s.nw} ${s.askNw}` : `${sora.variable} ${s.lg} ${s.askLg}`}>
        <div className={s.askInner}>
          <h2 className={s.askTitle}>{site === "northwind" ? "Got a question before you ride?" : "Questions about Ledgerly?"}</h2>
          <p className={s.askLede}>
            Our assistant answers from our help articles and shows where each answer came from. Try one of these:
          </p>
          <AskButtons questions={QUESTIONS[site]} className={s.askList} />
        </div>
      </section>
      <DemoHint slug={site} />
      {/* The real embed: exactly what a customer pastes into their site. */}
      <script src="/widget.js" data-key={key} async />
    </>
  );
}

function Northwind() {
  return (
    <div className={`${archivo.variable} ${s.nw}`}>
      <header className={s.nwNav}>
        <span className={s.nwLogo}>
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <circle cx="16" cy="16" r="14" fill="#0f7b6c" />
            <path d="M9 21 16 8l7 13M12 16h8" stroke="#f4c430" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
          </svg>
          Northwind Cycles
        </span>
        <nav className={s.nwLinks} aria-label="Shop">
          <span>E-bikes</span>
          <span>Servicing</span>
          <span>Support</span>
        </nav>
      </header>
      <main className={s.nwHero}>
        <div className={s.nwCopy}>
          <p className={s.nwKicker}>New · Volt 2026</p>
          <h1 className={s.nwH1}>Ride further. Charge less.</h1>
          <p className={s.nwLede}>
            Hand-built e-bikes with a 120 km range, a 5-year frame warranty and free delivery, 90% assembled.
          </p>
          <div className={s.nwCtas}>
            <span className={s.nwBtn}>Shop the Volt — €2,890</span>
            <span className={s.nwBtnAlt}>Book a test ride</span>
          </div>
        </div>
        <div className={s.nwArt}>
          <Bike />
        </div>
      </main>
      <ul className={s.nwPerks}>
        <li><b>5-year</b> frame warranty</li>
        <li><b>30-day</b> returns</li>
        <li><b>2-day</b> dispatch</li>
        <li><b>Care Plus</b> servicing €89/yr</li>
      </ul>
      <section className={s.nwModels} aria-label="Models">
        {[
          ["Volt", "City commuter", "€2,890", "120 km"],
          ["Ridge", "Trail hardtail", "€3,450", "95 km"],
          ["Haul", "Family cargo", "€4,190", "80 km"],
        ].map(([name, kind, price, range]) => (
          <article key={name} className={s.nwModel}>
            <p className={s.nwModelName}>{name}</p>
            <p className={s.nwModelKind}>{kind}</p>
            <p className={s.nwModelMeta}>
              <span>{price}</span>
              <span>{range} range</span>
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}

function Ledgerly() {
  return (
    <div className={`${sora.variable} ${s.lg}`}>
      <header className={s.lgNav}>
        <span className={s.lgLogo}>
          <span className={s.lgMark} aria-hidden="true">L</span>
          ledgerly
        </span>
        <nav className={s.lgLinks} aria-label="Product">
          <span>Product</span>
          <span>Pricing</span>
          <span>Docs</span>
          <span className={s.lgSignin}>Sign in</span>
        </nav>
      </header>
      <main className={s.lgHero}>
        <div>
          <h1 className={s.lgH1}>
            Invoices that <em>chase themselves.</em>
          </h1>
          <p className={s.lgLede}>
            Send branded invoices, set up recurring billing and let automatic reminders get you paid — without the awkward
            emails.
          </p>
          <div className={s.lgCtas}>
            <span className={s.lgBtn}>Start free</span>
            <span className={s.lgNote}>Free for 5 invoices a month · no card</span>
          </div>
        </div>
        <div className={s.lgInvoice} aria-hidden="true">
          <div className={s.lgInvHead}>
            <span>Invoice #0042</span>
            <span className={s.lgPaid}>Paid</span>
          </div>
          <p className={s.lgInvTo}>Billed to <b>Harbor &amp; Pine Studio</b></p>
          <ul className={s.lgLines}>
            <li><span>Brand workshop (2 days)</span><span>$2,400.00</span></li>
            <li><span>Illustration set</span><span>$860.00</span></li>
            <li><span>Revisions</span><span>$240.00</span></li>
          </ul>
          <div className={s.lgTotal}><span>Total</span><span>$3,500.00</span></div>
          <p className={s.lgRemind}>Reminder sent 3 days before due · paid on day 12</p>
        </div>
      </main>
      <section className={s.lgPlans} aria-label="Plans">
        {[
          ["Starter", "$0", "5 invoices / month"],
          ["Growth", "$19", "Recurring invoices, reminders"],
          ["Scale", "$49", "SSO, audit export, 600 API req/min"],
        ].map(([name, price, what]) => (
          <article key={name} className={s.lgPlan}>
            <p className={s.lgPlanName}>{name}</p>
            <p className={s.lgPlanPrice}>
              {price}
              <span>/mo</span>
            </p>
            <p className={s.lgPlanWhat}>{what}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
