export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
export const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000").replace(/\/$/, "");
export const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

/** Publishable widget keys of the seeded demo tenants (public by design). */
export const DEMO_WIDGET_KEYS: Record<string, string> = {
  northwind: process.env.NEXT_PUBLIC_WIDGET_KEY_NORTHWIND || "pk_demo_northwind",
  ledgerly: process.env.NEXT_PUBLIC_WIDGET_KEY_LEDGERLY || "pk_demo_ledgerly",
};

export const DEMO_TENANTS = [
  { slug: "northwind", name: "Northwind Cycles", blurb: "E-bike shop" },
  { slug: "ledgerly", name: "Ledgerly", blurb: "Invoicing SaaS" },
] as const;
