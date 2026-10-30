// Synthetic fixtures for NEXT_PUBLIC_MOCK=1. Companies, people and data are fictional.
import type {
  AuditEntry,
  Citation,
  ConversationStatus,
  DocumentRow,
  Invite,
  Member,
  Message,
  Redaction,
  Tenant,
  Ticket,
} from "../types";

const MIN = 60_000;
export const ago = (minutes: number) => new Date(Date.now() - minutes * MIN).toISOString();

export const tenants: Tenant[] = [
  {
    id: "t-northwind",
    name: "Northwind Cycles",
    slug: "northwind",
    widget_key: "pk_demo_northwind",
    allowed_origins: ["http://localhost:3000", "https://northwind-cycles.example"],
    brand_color: "#0f7b6c",
    confidence_threshold: 0.55,
  },
  {
    id: "t-ledgerly",
    name: "Ledgerly",
    slug: "ledgerly",
    widget_key: "pk_demo_ledgerly",
    allowed_origins: ["http://localhost:3000", "https://ledgerly.example"],
    brand_color: "#5b3fd6",
    confidence_threshold: 0.6,
  },
];

export const greetings: Record<string, string> = {
  "t-northwind": "Hi! I'm the Northwind assistant. Ask me about warranty, returns, shipping or battery care.",
  "t-ledgerly": "Hi! Ask me anything about Ledgerly plans, billing, SSO or exporting your data.",
};

export const members: Record<string, Member[]> = {
  "t-northwind": [
    { user_id: "u-nw-owner", email: "owner@northwind.demo", name: "Maya Okafor", role: "owner", created_at: ago(60 * 24 * 40) },
    { user_id: "u-nw-admin", email: "admin@northwind.demo", name: "Tomás Reyes", role: "admin", created_at: ago(60 * 24 * 32) },
    { user_id: "u-nw-agent", email: "agent@northwind.demo", name: "Priya Nair", role: "agent", created_at: ago(60 * 24 * 21) },
    { user_id: "u-nw-agent2", email: "jonas@northwind.demo", name: "Jonas Lind", role: "agent", created_at: ago(60 * 24 * 6) },
  ],
  "t-ledgerly": [
    { user_id: "u-lg-owner", email: "owner@ledgerly.demo", name: "Hannah Brooks", role: "owner", created_at: ago(60 * 24 * 55) },
    { user_id: "u-lg-admin", email: "admin@ledgerly.demo", name: "Kenji Watanabe", role: "admin", created_at: ago(60 * 24 * 41) },
    { user_id: "u-lg-agent", email: "agent@ledgerly.demo", name: "Lucía Ferreira", role: "agent", created_at: ago(60 * 24 * 12) },
  ],
};

export const invites: Record<string, Invite[]> = {
  "t-northwind": [
    {
      id: "inv-1",
      email: "sam@northwind.demo",
      role: "agent",
      token: "demo-invite-northwind",
      accepted_at: null,
      expires_at: new Date(Date.now() + 5 * 24 * 60 * MIN).toISOString(),
      created_at: ago(60 * 24 * 2),
    },
  ],
  "t-ledgerly": [],
};

function doc(
  id: string,
  title: string,
  source_type: DocumentRow["source_type"],
  chunk_count: number,
  minutesAgo: number,
  extra: Partial<DocumentRow> = {},
): DocumentRow {
  return {
    id,
    title,
    source_type,
    source_url: null,
    status: "indexed",
    error: null,
    chunk_count,
    attempts: 1,
    created_at: ago(minutesAgo),
    updated_at: ago(minutesAgo - 2),
    ...extra,
  };
}

export const documents: Record<string, DocumentRow[]> = {
  "t-northwind": [
    doc("d-nw-warranty", "Warranty Policy 2026.pdf", "pdf", 24, 60 * 24 * 9),
    doc("d-nw-returns", "Returns & Refunds.md", "text", 9, 60 * 24 * 9),
    doc("d-nw-shipping", "Shipping & Delivery.docx", "docx", 14, 60 * 24 * 8),
    doc("d-nw-battery", "Battery Care Guide.pdf", "pdf", 31, 60 * 24 * 7),
    doc("d-nw-service", "Servicing plans", "url", 11, 60 * 24 * 3, {
      source_url: "https://northwind-cycles.example/servicing",
    }),
    doc("d-nw-dealer", "Dealer price list (scanned).pdf", "pdf", 0, 60 * 26, {
      status: "failed",
      attempts: 3,
      error: "No extractable text: the PDF is image-only (scanned). Upload a text PDF or DOCX.",
    }),
  ],
  "t-ledgerly": [
    doc("d-lg-plans", "Plans & Pricing.md", "text", 12, 60 * 24 * 12),
    doc("d-lg-billing", "Billing FAQ.pdf", "pdf", 19, 60 * 24 * 12),
    doc("d-lg-sso", "SSO setup (SAML & OIDC).docx", "docx", 22, 60 * 24 * 10),
    doc("d-lg-export", "Exporting your data.md", "text", 8, 60 * 24 * 6),
    doc("d-lg-api", "API rate limits", "url", 7, 60 * 24 * 2, { source_url: "https://docs.ledgerly.example/api/limits" }),
  ],
};

// ---------- conversations ----------

export interface MockConversation {
  id: string;
  tenant_id: string;
  visitor_id: string;
  status: ConversationStatus;
  created_at: string;
  last_message_at: string;
  messages: Message[];
  ticket_id: string | null;
}

const cite = (n: number, document_id: string, document_title: string, heading: string, page: number | null, snippet: string): Citation => ({
  n,
  chunk_id: `${document_id}-c${n}`,
  document_id,
  document_title,
  heading,
  page,
  snippet,
});

export const CITES = {
  warrantyFrame: cite(1, "d-nw-warranty", "Warranty Policy 2026.pdf", "Frame & fork", 2,
    "Aluminium and steel frames are covered for 5 years against manufacturing defects from the date of delivery. Carbon forks are covered for 2 years."),
  warrantyBattery: cite(2, "d-nw-warranty", "Warranty Policy 2026.pdf", "Battery & motor", 3,
    "Batteries and motors are covered for 2 years or 800 full charge cycles, whichever comes first. Capacity below 60% within that period counts as a defect."),
  returns: cite(1, "d-nw-returns", "Returns & Refunds.md", "30-day returns", null,
    "You can return an unused e-bike within 30 days of delivery. Bikes must have under 25 km on the odometer. Refunds are issued to the original payment method within 5 business days of inspection."),
  shipping: cite(1, "d-nw-shipping", "Shipping & Delivery.docx", "Delivery times", null,
    "Orders ship within 2 business days. Standard delivery takes 3–5 business days in the mainland; e-bikes arrive 90% assembled with a torque wrench and setup guide."),
  batteryWinter: cite(1, "d-nw-battery", "Battery Care Guide.pdf", "Storing your battery in winter", 7,
    "Store the battery indoors between 10 °C and 20 °C at 40–60% charge. Top it up to 50% every 6–8 weeks. Never charge a battery that is below 0 °C."),
  batteryCharge: cite(2, "d-nw-battery", "Battery Care Guide.pdf", "Everyday charging", 4,
    "Use only the supplied 4 A charger. Avoid leaving the battery at 100% for more than a day; charge to 80% for daily commuting."),
  service: cite(1, "d-nw-service", "Servicing plans", "Care Plus", null,
    "Care Plus costs €89 per year and includes two workshop services, brake pad replacement and a firmware update for the drive unit."),
  plans: cite(1, "d-lg-plans", "Plans & Pricing.md", "Plans", null,
    "Starter is free for up to 5 invoices a month. Growth is $19/month per workspace and includes recurring invoices and reminders. Scale is $49/month and adds SSO and audit export."),
  proration: cite(2, "d-lg-billing", "Billing FAQ.pdf", "Changing plans mid-cycle", 3,
    "Upgrades take effect immediately and are prorated to the day. Downgrades apply at the end of the current billing period."),
  sso: cite(1, "d-lg-sso", "SSO setup (SAML & OIDC).docx", "Okta (SAML 2.0)", null,
    "In Okta, create a SAML 2.0 app with the ACS URL https://app.ledgerly.example/sso/acs and Audience URI urn:ledgerly:sp. Upload the IdP metadata XML under Settings → Security → SSO."),
  export: cite(1, "d-lg-export", "Exporting your data.md", "CSV and JSON export", null,
    "Owners can export invoices, clients and payments as CSV or JSON from Settings → Data. Exports up to 50,000 rows are generated in under a minute and emailed as a link valid for 24 hours."),
  apiLimits: cite(1, "d-lg-api", "API rate limits", "Limits per plan", null,
    "The REST API allows 60 requests per minute on Growth and 600 per minute on Scale. Responses over the limit return 429 with a Retry-After header."),
};

let msgSeq = 0;
function m(
  role: Message["role"],
  content: string,
  minutesAgo: number,
  extra: Partial<Message> = {},
): Message {
  msgSeq += 1;
  return {
    id: `m-${msgSeq}`,
    role,
    content,
    redactions: [],
    intent: null,
    confidence: null,
    confidence_breakdown: null,
    citations: [],
    escalated: false,
    created_at: ago(minutesAgo),
    ...extra,
  };
}

/** Same shape as the ai service's ConfidenceBreakdown (0.45·R + 0.35·C + 0.20·A, then caps). */
export function breakdown(retrieval: number, coverage: number, answerable: boolean) {
  const claims = coverage > 0 ? 4 : 2;
  const a = answerable ? 1 : 0;
  let value = 0.45 * retrieval + 0.35 * coverage + 0.2 * a;
  let cap: string | null = null;
  if (!answerable && value > 0.3) [value, cap] = [0.3, "not_answerable"];
  else if (coverage === 0 && value > 0.35) [value, cap] = [0.35, "uncited"];
  return {
    mode: "grounded",
    answerable: answerable ? "yes" : "no",
    confidence: Math.round(value * 1000) / 1000,
    cap_applied: cap,
    cited_sentences: Math.round(claims * coverage),
    claim_sentences: claims,
    answerable_score: a,
    top_cited_cosine: Math.round((0.6 + retrieval * 0.2) * 10000) / 10000,
    citation_coverage: coverage,
    retrieval_strength: retrieval,
  };
}

export const confidenceOf = (b: ReturnType<typeof breakdown>) => b.confidence;

function ai(content: string, minutesAgo: number, intent: string, b: ReturnType<typeof breakdown>, citations: Citation[], escalated = false): Message {
  return m("assistant", content, minutesAgo, { intent, confidence: confidenceOf(b), confidence_breakdown: b, citations, escalated });
}

function conv(
  id: string,
  tenant_id: string,
  visitor: string,
  status: ConversationStatus,
  messages: Message[],
  ticket_id: string | null = null,
): MockConversation {
  return {
    id,
    tenant_id,
    visitor_id: visitor,
    status,
    created_at: messages[0].created_at,
    last_message_at: messages[messages.length - 1].created_at,
    messages,
    ticket_id,
  };
}

const red = (type: Redaction["type"], count = 1): Redaction[] => [{ type, count }];

export const conversations: MockConversation[] = [
  conv("c-nw-1", "t-northwind", "v_8f21c0", "resolved", [
    m("user", "How should I store my battery over the winter? My garage gets below freezing.", 14, { intent: "how_to" }),
    ai(
      "Bring the battery indoors and keep it between 10 °C and 20 °C at roughly 40–60% charge [1]. Top it up to about 50% every 6–8 weeks, and never charge it while it's below 0 °C — let it warm to room temperature first [1]. For daily riding in spring, charging to 80% is gentler on the cells than leaving it at 100% [2].",
      13, "how_to", breakdown(0.91, 1, true), [CITES.batteryWinter, CITES.batteryCharge]),
  ]),
  conv("c-nw-2", "t-northwind", "v_31aa9e", "escalated", [
    m("user", "My battery died after 14 months and the shop says it's not covered. This is ridiculous, I want a manager. Email me at [EMAIL_1] or call [PHONE_1].", 38, {
      intent: "complaint",
      redactions: [...red("EMAIL"), ...red("PHONE")],
    }),
    ai(
      "I'm sorry the battery failed. Batteries are covered for 2 years or 800 full charge cycles, and capacity below 60% inside that window counts as a defect [1]. Since you've asked for a manager, I've handed this to our team — ticket #1042 is open and someone will contact you.",
      37, "complaint", breakdown(0.74, 1, true), [{ ...CITES.warrantyBattery, n: 1 }], true),
    m("human_agent", "Hi, this is Priya from Northwind. 14 months is inside the 2-year warranty — please bring the battery to any partner workshop and we'll run a capacity test at no cost.", 22, { author_name: "Priya Nair", author_user_id: "u-nw-agent" }),
  ], "tk-1042"),
  conv("c-nw-3", "t-northwind", "v_77b310", "escalated", [
    m("user", "Can I ride my Northwind Volt through a river crossing about 40cm deep?", 95, { intent: "how_to" }),
    ai(
      "I couldn't find guidance on water depth or wading in our documentation, so I don't want to guess. I've passed your question to a specialist — ticket #1041.",
      94, "how_to", breakdown(0.29, 0, false), [], true),
  ], "tk-1041"),
  conv("c-nw-4", "t-northwind", "v_0c99d2", "resolved", [
    m("user", "What's the return window if I change my mind?", 160, { intent: "billing" }),
    ai(
      "You can return an unused e-bike within 30 days of delivery, as long as it has under 25 km on the odometer [1]. Once we've inspected it, the refund goes back to your original payment method within 5 business days [1].",
      159, "billing", breakdown(0.88, 1, true), [CITES.returns]),
  ]),
  conv("c-nw-5", "t-northwind", "v_5e1f07", "open", [
    m("user", "Does the warranty cover the carbon fork if I crash?", 230, { intent: "how_to" }),
    ai(
      "Carbon forks are covered for 2 years against manufacturing defects [1]. The policy I can see covers defects rather than crash damage, so a crash may not qualify — a workshop inspection would confirm it.",
      229, "how_to", breakdown(0.62, 0.5, true), [CITES.warrantyFrame]),
  ]),
  conv("c-nw-6", "t-northwind", "v_aa4410", "resolved", [
    m("user", "How long does shipping take to Lyon?", 300, { intent: "how_to" }),
    ai(
      "Orders ship within 2 business days, and standard delivery takes 3–5 business days on the mainland [1]. The bike arrives 90% assembled, with a torque wrench and setup guide in the box [1].",
      299, "how_to", breakdown(0.83, 1, true), [CITES.shipping]),
  ]),
  conv("c-nw-7", "t-northwind", "v_19d0b4", "escalated", [
    m("user", "I need to talk to a real person please.", 410, { intent: "human_request" }),
    ai("Of course — I've asked a member of our team to pick this up. Ticket #1040 is open and you'll hear back by email.", 409, "human_request",
      breakdown(0.4, 0, true), [], true),
  ], "tk-1040"),
  conv("c-nw-8", "t-northwind", "v_d2c8e1", "resolved", [
    m("user", "What's included in Care Plus?", 520, { intent: "billing" }),
    ai("Care Plus is €89 per year and includes two workshop services, brake pad replacement and a firmware update for the drive unit [1].",
      519, "billing", breakdown(0.86, 1, true), [CITES.service]),
  ]),
  conv("c-nw-9", "t-northwind", "v_61f3aa", "open", [
    m("user", "Charge my card [CARD_1] for the Care Plus plan please", 640, { intent: "billing", redactions: red("CARD") }),
    ai("For your security I can't take payment details in chat — I've hidden the card number you sent. Care Plus is €89 per year [1]; you can add it from your account's Orders page.",
      639, "billing", breakdown(0.66, 1, true), [CITES.service]),
  ]),
  conv("c-nw-10", "t-northwind", "v_4b7712", "resolved", [
    m("user", "hey there!", 900, { intent: "smalltalk" }),
    ai("Hi! I can help with warranty, returns, shipping, servicing and battery care. What would you like to know?", 899, "smalltalk", breakdown(0.7, 1, true), []),
  ]),

  conv("c-lg-1", "t-ledgerly", "v_e01d5c", "resolved", [
    m("user", "If I upgrade from Growth to Scale today, do I pay the full month?", 20, { intent: "billing" }),
    ai("No — upgrades take effect immediately and are prorated to the day [2]. Scale is $49/month and adds SSO and audit export on top of Growth [1].",
      19, "billing", breakdown(0.9, 1, true), [CITES.plans, CITES.proration]),
  ]),
  conv("c-lg-2", "t-ledgerly", "v_b5c2a1", "escalated", [
    m("user", "We were charged twice this month, IBAN [IBAN_1]. Fix it now or we cancel.", 75, { intent: "complaint", redactions: red("IBAN") }),
    ai("I'm sorry about the double charge. I've escalated this to our billing team with priority — ticket #2207 — and they'll reply by email.",
      74, "complaint", breakdown(0.45, 0, true), [], true),
  ], "tk-2207"),
  conv("c-lg-3", "t-ledgerly", "v_9a0f33", "resolved", [
    m("user", "How do I set up SSO with Okta?", 180, { intent: "how_to" }),
    ai("In Okta, create a SAML 2.0 app with ACS URL https://app.ledgerly.example/sso/acs and Audience URI urn:ledgerly:sp [1]. Then upload the IdP metadata XML under Settings → Security → SSO [1]. SSO is included on the Scale plan.",
      179, "how_to", breakdown(0.87, 1, true), [CITES.sso]),
  ]),
  conv("c-lg-4", "t-ledgerly", "v_33dd70", "escalated", [
    m("user", "Do you support Xero two-way sync?", 260, { intent: "how_to" }),
    ai("I don't have documentation about a Xero integration, so I can't confirm it. I've asked the team to answer — ticket #2206.",
      259, "how_to", breakdown(0.24, 0, false), [], true),
  ], "tk-2206"),
  conv("c-lg-5", "t-ledgerly", "v_70ab12", "open", [
    m("user", "What is the API rate limit on Growth?", 400, { intent: "how_to" }),
    ai("Growth allows 60 requests per minute; Scale allows 600 [1]. Requests over the limit get a 429 with a Retry-After header [1].",
      399, "how_to", breakdown(0.79, 1, true), [CITES.apiLimits]),
  ]),
];

export const tickets: (Ticket & { tenant_id: string })[] = [
  { id: "tk-1042", number: 1042, tenant_id: "t-northwind", conversation_id: "c-nw-2", subject: "Battery failed at 14 months — customer requests manager", summary: "Customer's battery failed after 14 months; shop refused warranty. Within 2-year battery coverage per policy. Customer is upset and asked for a manager.", priority: "high", status: "pending", source: "escalation", reason: "intent=complaint", assignee_user_id: "u-nw-agent", notification_status: "sent", created_at: ago(37), updated_at: ago(22) },
  { id: "tk-1041", number: 1041, tenant_id: "t-northwind", conversation_id: "c-nw-3", subject: "River crossing / water depth for Volt", summary: "Visitor asks whether a Volt can wade through ~40 cm of water. No documentation covers water ingress limits.", priority: "normal", status: "open", source: "ai_tool", reason: "confidence 0.13 < 0.55", assignee_user_id: null, notification_status: "sent", created_at: ago(94), updated_at: ago(94) },
  { id: "tk-1040", number: 1040, tenant_id: "t-northwind", conversation_id: "c-nw-7", subject: "Visitor asked for a human", summary: "Visitor asked to talk to a person without further detail.", priority: "low", status: "open", source: "escalation", reason: "intent=human_request", assignee_user_id: null, notification_status: "skipped", created_at: ago(409), updated_at: ago(409) },
  { id: "tk-1039", number: 1039, tenant_id: "t-northwind", conversation_id: null, subject: "Firmware update failed on drive unit", summary: "Bug report: firmware update stuck at 80% on the Volt drive unit.", priority: "urgent", status: "closed", source: "ai_tool", reason: "intent=bug_report", assignee_user_id: "u-nw-admin", notification_status: "failed", created_at: ago(60 * 30), updated_at: ago(60 * 20) },
  { id: "tk-2207", number: 2207, tenant_id: "t-ledgerly", conversation_id: "c-lg-2", subject: "Double charge this month — threat to cancel", summary: "Customer reports being charged twice this month and threatens to cancel. Bank details were redacted.", priority: "urgent", status: "open", source: "escalation", reason: "intent=complaint", assignee_user_id: null, notification_status: "sent", created_at: ago(74), updated_at: ago(74) },
  { id: "tk-2206", number: 2206, tenant_id: "t-ledgerly", conversation_id: "c-lg-4", subject: "Xero two-way sync?", summary: "Visitor asks about a Xero integration. Not covered in the knowledge base.", priority: "normal", status: "open", source: "ai_tool", reason: "confidence 0.11 < 0.60", assignee_user_id: null, notification_status: "skipped", created_at: ago(259), updated_at: ago(259) },
];

function audit(id: number, tenant_id: string, minutesAgo: number, actor_type: AuditEntry["actor_type"], actor: string | null, action: string, target_type: string | null, target_id: string | null, metadata: Record<string, unknown> = {}): AuditEntry & { tenant_id: string } {
  return { id, tenant_id, actor_type, actor_id: actor, actor_email: actor && actor.includes("@") ? actor : null, action, target_type, target_id, metadata, created_at: ago(minutesAgo) };
}

export const auditLog: (AuditEntry & { tenant_id: string })[] = [
  audit(118, "t-northwind", 22, "user", "agent@northwind.demo", "human.replied", "conversation", "c-nw-2"),
  audit(117, "t-northwind", 23, "user", "agent@northwind.demo", "ticket.updated", "ticket", "1042", { status: { from: "open", to: "pending" } }),
  audit(116, "t-northwind", 37, "system", null, "notification.sent", "ticket", "1042", { channel: "n8n", http_status: 200 }),
  audit(115, "t-northwind", 37, "ai", null, "ticket.created", "ticket", "1042", { priority: "high", source: "escalation" }),
  audit(114, "t-northwind", 37, "ai", null, "conversation.escalated", "conversation", "c-nw-2", { reason: "intent=complaint" }),
  audit(113, "t-northwind", 38, "widget", "v_31aa9e", "pii.redacted", "message", "m-2", { types: ["EMAIL", "PHONE"] }),
  audit(112, "t-northwind", 94, "system", null, "notification.sent", "ticket", "1041", { channel: "n8n", http_status: 200 }),
  audit(111, "t-northwind", 94, "ai", null, "ticket.created", "ticket", "1041", { priority: "normal", source: "ai_tool" }),
  audit(110, "t-northwind", 94, "ai", null, "conversation.escalated", "conversation", "c-nw-3", { reason: "confidence 0.13 < 0.55" }),
  audit(109, "t-northwind", 409, "system", null, "notification.skipped", "ticket", "1040", { reason: "N8N_WEBHOOK_URL not set" }),
  audit(108, "t-northwind", 640, "widget", "v_61f3aa", "pii.redacted", "message", "m-17", { types: ["CARD"] }),
  audit(107, "t-northwind", 60 * 26, "system", null, "document.uploaded", "document", "d-nw-dealer", { title: "Dealer price list (scanned).pdf" }),
  audit(106, "t-northwind", 60 * 24 * 2, "user", "owner@northwind.demo", "invite.created", "invite", "inv-1", { email: "sam@northwind.demo", role: "agent" }),
  audit(105, "t-northwind", 60 * 24 * 3, "user", "admin@northwind.demo", "document.uploaded", "document", "d-nw-service", { url: "https://northwind-cycles.example/servicing" }),
  audit(104, "t-northwind", 60 * 24 * 4, "user", "owner@northwind.demo", "settings.updated", "tenant", "t-northwind", { confidence_threshold: { from: 0.5, to: 0.55 } }),
  audit(103, "t-northwind", 60 * 24 * 6, "user", "owner@northwind.demo", "member.role_changed", "user", "u-nw-agent2", { from: "admin", to: "agent" }),
  audit(102, "t-northwind", 60 * 24 * 6, "user", "owner@northwind.demo", "auth.login", "user", "u-nw-owner", { method: "password" }),
  audit(201, "t-ledgerly", 74, "ai", null, "conversation.escalated", "conversation", "c-lg-2", { reason: "intent=complaint" }),
  audit(202, "t-ledgerly", 74, "widget", "v_b5c2a1", "pii.redacted", "message", "m-25", { types: ["IBAN"] }),
  audit(203, "t-ledgerly", 74, "ai", null, "ticket.created", "ticket", "2207", { priority: "urgent", source: "escalation" }),
  audit(204, "t-ledgerly", 74, "system", null, "notification.sent", "ticket", "2207", { channel: "n8n", http_status: 200 }),
  audit(205, "t-ledgerly", 60 * 24 * 2, "user", "admin@ledgerly.demo", "document.uploaded", "document", "d-lg-api", { url: "https://docs.ledgerly.example/api/limits" }),
];
