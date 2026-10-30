// In-browser stand-in for the API (NEXT_PUBLIC_MOCK=1). Same interface as the
// HTTP client so every page can be built and reviewed without the backend.
import type { Api } from "../api";
import { ApiError } from "../errors";
import { getSession } from "../session";
import type {
  Analytics,
  ChatEvent,
  Citation,
  ConversationSummary,
  DocumentRow,
  LoginPayload,
  Membership,
  Message,
  Redaction,
  Role,
} from "../types";
import {
  CITES,
  auditLog,
  breakdown,
  confidenceOf,
  conversations,
  documents,
  greetings,
  invites,
  members,
  tenants,
  tickets,
} from "./fixtures";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => wait(180 + Math.random() * 220);

function tenantOr404(tid: string) {
  const t = tenants.find((x) => x.id === tid);
  if (!t) throw new ApiError(404, "Not found.");
  return t;
}

function currentRole(tid: string): Role {
  const s = getSession();
  if (!s) throw new ApiError(401, "Sign in to continue.");
  const m = s.memberships.find((x) => x.tenant_id === tid);
  if (!m) throw new ApiError(404, "Not found.");
  return m.role;
}

function requireRole(tid: string, ...roles: Role[]) {
  const role = currentRole(tid);
  if (!roles.includes(role)) throw new ApiError(403, `Your role (${role}) can't do this.`);
}

function payloadFor(email: string): LoginPayload {
  const memberships: Membership[] = [];
  let user = { id: "", email, name: "" };
  for (const t of tenants) {
    const mem = members[t.id].find((m) => m.email === email);
    if (mem) {
      user = { id: mem.user_id, email, name: mem.name };
      memberships.push({ tenant_id: t.id, tenant_name: t.name, tenant_slug: t.slug, role: mem.role });
    }
  }
  if (!memberships.length) throw new ApiError(401, "Wrong email or password.");
  // The demo owner of Northwind is also an agent at Ledgerly, to show the tenant switcher.
  if (email === "owner@northwind.demo") {
    memberships.push({ tenant_id: "t-ledgerly", tenant_name: "Ledgerly", tenant_slug: "ledgerly", role: "agent" });
  }
  return { token: `mock.${btoa(email)}`, user, memberships };
}

function summary(c: (typeof conversations)[number]): ConversationSummary {
  const firstUser = c.messages.find((m) => m.role === "user");
  const answers = c.messages.filter((m) => m.role === "assistant" && m.confidence !== null);
  const last = answers[answers.length - 1];
  const t = c.ticket_id ? tickets.find((x) => x.id === c.ticket_id) : null;
  return {
    id: c.id,
    channel: "widget",
    visitor_id: c.visitor_id,
    status: c.status,
    created_at: c.created_at,
    last_message_at: c.last_message_at,
    first_message: firstUser?.content ?? null,
    intent: firstUser?.intent ?? last?.intent ?? null,
    confidence: last?.confidence ?? null,
    message_count: c.messages.length,
    ticket: t ? { id: t.id, number: t.number } : null,
  };
}

function analyticsFor(tid: string, days: number): Analytics {
  const t = tenantOr404(tid);
  const seed = tid === "t-northwind" ? 7 : 3;
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const weekday = d.getDay();
    const base = (tid === "t-northwind" ? 34 : 21) + ((i * seed) % 11) - (weekday === 0 || weekday === 6 ? 9 : 0);
    const escalated = Math.max(1, Math.round(base * (0.14 + ((i * 5 + seed) % 7) / 100)));
    return { day: d.toISOString().slice(0, 10), conversations: base, escalated };
  });
  const total = daily.reduce((s, d) => s + d.conversations, 0);
  const esc = daily.reduce((s, d) => s + d.escalated, 0);
  const intents =
    tid === "t-northwind"
      ? ["how_to", "billing", "account", "complaint", "bug_report", "human_request", "out_of_scope", "smalltalk"]
      : ["billing", "how_to", "account", "bug_report", "complaint", "human_request", "smalltalk", "out_of_scope"];
  const shares = [0.38, 0.21, 0.12, 0.08, 0.07, 0.06, 0.05, 0.03];
  return {
    conversations: total,
    ai_resolved: total - esc,
    escalated: esc,
    deflection_rate: (total - esc) / total,
    low_confidence: Math.round(esc * 0.55),
    avg_confidence: tid === "t-northwind" ? 0.74 : 0.69,
    by_intent: intents.map((intent, i) => ({ intent, count: Math.round(total * shares[i]) })),
    daily,
    top_unanswered:
      t.slug === "northwind"
        ? [
            { question: "Can I ride the Volt through a 40 cm river crossing?", confidence: 0.13 },
            { question: "Do you ship e-bikes to the Canary Islands?", confidence: 0.22 },
            { question: "Is the Volt's motor legal in Switzerland at 45 km/h?", confidence: 0.31 },
            { question: "Can I fit a child seat on the rear rack?", confidence: 0.41 },
            { question: "Does the crash replacement discount apply to used bikes?", confidence: 0.52 },
          ]
        : [
            { question: "Do you support Xero two-way sync?", confidence: 0.11 },
            { question: "Can invoices be issued in Japanese yen with JCT?", confidence: 0.27 },
            { question: "Is there a HIPAA BAA available?", confidence: 0.33 },
            { question: "Can I white-label the client portal?", confidence: 0.48 },
          ],
  };
}

// ---------- chat simulation ----------

const PII: { type: Redaction["type"]; re: RegExp }[] = [
  { type: "EMAIL", re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  { type: "CARD", re: /\b(?:\d[ -]?){13,16}\b/g },
  { type: "IBAN", re: /\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}\b/g },
  { type: "PHONE", re: /\+?\d[\d\s().-]{7,}\d/g },
];

function redact(text: string): { redacted: string; redactions: Redaction[] } {
  let out = text;
  const redactions: Redaction[] = [];
  for (const { type, re } of PII) {
    let count = 0;
    out = out.replace(re, () => `[${type}_${++count}]`);
    if (count) redactions.push({ type, count });
  }
  return { redacted: out, redactions };
}

interface Scenario {
  intent: string;
  answer: string;
  citations: Citation[];
  b: ReturnType<typeof breakdown>;
  forceEscalate?: boolean;
}

function pickScenario(tenantId: string, text: string): Scenario {
  const q = text.toLowerCase();
  const human = /\b(human|person|agent|manager|someone real)\b/.test(q);
  if (human || /ridiculous|unacceptable|furious|cancel/.test(q)) {
    return {
      intent: human ? "human_request" : "complaint",
      answer: "I understand — I'm handing this conversation to a member of our team so a person can pick it up.",
      citations: [],
      b: breakdown(0.42, 0, true),
      forceEscalate: true,
    };
  }
  const nw: [RegExp, Scenario][] = [
    [/winter|store|cold|freez/, { intent: "how_to", answer: "Store the battery indoors between 10 °C and 20 °C at about 40–60% charge [1]. Top it up to 50% every 6–8 weeks, and never charge it below 0 °C [1].", citations: [CITES.batteryWinter], b: breakdown(0.9, 1, true) }],
    [/battery|charg/, { intent: "how_to", answer: "Use only the supplied 4 A charger, and for daily commuting charge to 80% rather than leaving it at 100% [1]. Batteries are covered for 2 years or 800 full cycles [2].", citations: [{ ...CITES.batteryCharge, n: 1 }, CITES.warrantyBattery], b: breakdown(0.84, 1, true) }],
    [/warrant|frame|fork/, { intent: "how_to", answer: "Frames are covered for 5 years against manufacturing defects and carbon forks for 2 years [1]. Batteries and motors are covered for 2 years or 800 charge cycles [2].", citations: [CITES.warrantyFrame, CITES.warrantyBattery], b: breakdown(0.88, 1, true) }],
    [/return|refund/, { intent: "billing", answer: "You can return an unused e-bike within 30 days of delivery if it has under 25 km on the odometer [1]. Refunds reach your original payment method within 5 business days of inspection [1].", citations: [CITES.returns], b: breakdown(0.87, 1, true) }],
    [/ship|deliver/, { intent: "how_to", answer: "Orders ship within 2 business days and standard delivery takes 3–5 business days on the mainland [1].", citations: [CITES.shipping], b: breakdown(0.8, 1, true) }],
    [/servic|care plus|plan/, { intent: "billing", answer: "Care Plus is €89 per year and includes two workshop services, brake pads and a drive-unit firmware update [1].", citations: [CITES.service], b: breakdown(0.78, 1, true) }],
  ];
  const lg: [RegExp, Scenario][] = [
    [/upgrade|prorat|downgrade/, { intent: "billing", answer: "Upgrades apply immediately and are prorated to the day; downgrades apply at the end of the billing period [1].", citations: [{ ...CITES.proration, n: 1 }], b: breakdown(0.89, 1, true) }],
    [/plan|price|cost/, { intent: "billing", answer: "Starter is free for 5 invoices a month, Growth is $19/month and Scale is $49/month with SSO and audit export [1].", citations: [CITES.plans], b: breakdown(0.86, 1, true) }],
    [/sso|okta|saml/, { intent: "how_to", answer: "Create a SAML 2.0 app in your IdP with ACS URL https://app.ledgerly.example/sso/acs, then upload the IdP metadata under Settings → Security → SSO [1].", citations: [CITES.sso], b: breakdown(0.85, 1, true) }],
    [/export|csv|json/, { intent: "how_to", answer: "Owners can export invoices, clients and payments as CSV or JSON from Settings → Data; you'll get a download link by email, valid for 24 hours [1].", citations: [CITES.export], b: breakdown(0.83, 1, true) }],
    [/api|rate|limit/, { intent: "how_to", answer: "Growth allows 60 API requests per minute and Scale 600; over the limit you get a 429 with Retry-After [1].", citations: [CITES.apiLimits], b: breakdown(0.81, 1, true) }],
  ];
  for (const [re, s] of tenantId === "t-northwind" ? nw : lg) if (re.test(q)) return s;
  if (/^(hi|hello|hey)\b/.test(q)) {
    return { intent: "smalltalk", answer: "Hi! What can I help you with today?", citations: [], b: breakdown(0.7, 1, true) };
  }
  return {
    intent: "out_of_scope",
    answer: "I couldn't find this in our help articles, so I won't guess. I'm passing your question to the team.",
    citations: [],
    b: breakdown(0.22, 0, false),
  };
}

let ticketNumber = 1043;
let convSeq = 1;

async function* mockChat(key: string, conversationId: string | undefined, message: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
  const t = tenants.find((x) => x.widget_key === key);
  if (!t) throw new ApiError(404, "Unknown widget key.");
  await wait(500);
  const { redacted, redactions } = redact(message);
  const s = pickScenario(t.id, redacted);
  yield { event: "meta", data: { intent: s.intent, redacted_message: redacted, redactions } };
  await wait(350);
  const answer = redactions.length && !s.forceEscalate
    ? `I've hidden the personal details you shared before reading your message. ${s.answer}`
    : s.answer;
  for (const word of answer.split(/(?<= )/)) {
    if (signal.aborted) return;
    await wait(28 + Math.random() * 30);
    yield { event: "token", data: { text: word } };
  }
  const confidence = confidenceOf(s.b);
  const escalate = Boolean(s.forceEscalate) || confidence < t.confidence_threshold;
  const ticket = escalate
    ? { subject: redacted.slice(0, 70), summary: `Visitor asked: ${redacted}`, priority: (s.intent === "complaint" ? "high" : "normal") as "high" | "normal" }
    : null;
  if (escalate) yield { event: "tool", data: { name: s.forceEscalate ? "handoff_to_human" : "create_ticket", input: ticket ?? {} } };
  yield {
    event: "done",
    data: {
      answer,
      intent: s.intent,
      confidence,
      confidence_breakdown: s.b,
      citations: s.citations,
      escalate,
      escalation_reason: escalate ? (s.forceEscalate ? `intent=${s.intent}` : `confidence ${confidence.toFixed(2)} < ${t.confidence_threshold.toFixed(2)}`) : null,
      ticket,
    },
  };
  await wait(200);
  const n = escalate ? ticketNumber++ : null;
  yield {
    event: "saved",
    data: {
      conversation_id: conversationId ?? `c-live-${convSeq++}`,
      message_id: `m-live-${Date.now()}`,
      ticket: n ? { id: `tk-${n}`, number: n } : null,
    },
  };
}

// ---------- document pipeline simulation ----------

const PIPELINE: DocumentRow["status"][] = ["queued", "parsing", "chunking", "embedding", "indexed"];

function runPipeline(row: DocumentRow, fail = false) {
  PIPELINE.forEach((status, i) => {
    setTimeout(() => {
      if (fail && status === "embedding") {
        row.status = "failed";
        row.error = "Could not fetch the page: the host returned 404 Not Found.";
        row.updated_at = new Date().toISOString();
        return;
      }
      if (row.status === "failed") return;
      row.status = status;
      if (status === "indexed") row.chunk_count = 6 + Math.floor(Math.random() * 18);
      row.updated_at = new Date().toISOString();
    }, i * 1600);
  });
}

let docSeq = 1;

export const mockApi: Api = {
  async health() {
    await wait(120);
    return true;
  },
  async login(email, password) {
    await latency();
    if (!password) throw new ApiError(400, "Enter your password.");
    return payloadFor(email.trim().toLowerCase());
  },
  async demoLogin(slug, role) {
    await latency();
    return payloadFor(`${role}@${slug}.demo`);
  },
  async me() {
    await latency();
    const s = getSession();
    if (!s) throw new ApiError(401, "Sign in to continue.");
    return { user: s.user, memberships: s.memberships };
  },
  async tenant(tid) {
    await latency();
    currentRole(tid);
    return { ...tenantOr404(tid) };
  },
  async updateSettings(tid, patch) {
    await latency();
    requireRole(tid, "owner");
    const t = tenantOr404(tid);
    Object.assign(t, patch);
    return { ...t };
  },
  async members(tid) {
    await latency();
    currentRole(tid);
    return members[tid].map((m) => ({ ...m }));
  },
  async changeRole(tid, uid, role) {
    await latency();
    requireRole(tid, "owner");
    const m = members[tid].find((x) => x.user_id === uid);
    if (!m) throw new ApiError(404, "Member not found.");
    m.role = role;
    return { ...m };
  },
  async invites(tid) {
    await latency();
    currentRole(tid);
    return invites[tid].map((i) => ({ ...i }));
  },
  async createInvite(tid, email, role) {
    await latency();
    requireRole(tid, "owner", "admin");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, "Enter a valid email address.");
    const token = `demo-invite-${Math.random().toString(36).slice(2, 10)}`;
    invites[tid].unshift({
      id: token,
      email,
      role,
      token,
      accepted_at: null,
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      created_at: new Date().toISOString(),
    });
    return { invite_url: `${window.location.origin}/invite/${token}` };
  },
  async publicInvite(token) {
    await latency();
    for (const t of tenants) {
      const inv = invites[t.id].find((i) => i.token === token);
      if (inv) return { email: inv.email, role: inv.role, tenant_name: t.name, expires_at: inv.expires_at, accepted_at: inv.accepted_at };
    }
    throw new ApiError(404, "This invite link is invalid or has expired.");
  },
  async acceptInvite(token, name, password) {
    await latency();
    if (password.length < 8) throw new ApiError(400, "Use at least 8 characters for your password.");
    for (const t of tenants) {
      const inv = invites[t.id].find((i) => i.token === token);
      if (inv) {
        inv.accepted_at = new Date().toISOString();
        const user_id = `u-${token}`;
        members[t.id].push({ user_id, email: inv.email, name, role: inv.role, created_at: inv.accepted_at });
        return {
          token: `mock.${btoa(inv.email)}`,
          user: { id: user_id, email: inv.email, name },
          memberships: [{ tenant_id: t.id, tenant_name: t.name, tenant_slug: t.slug, role: inv.role }],
        };
      }
    }
    throw new ApiError(404, "This invite link is invalid or has expired.");
  },
  async documents(tid) {
    await latency();
    currentRole(tid);
    return documents[tid].map((d) => ({ ...d }));
  },
  async uploadDocument(tid, file) {
    await latency();
    requireRole(tid, "owner", "admin");
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "docx", "txt", "md"].includes(ext)) throw new ApiError(415, "Upload a PDF, DOCX, TXT or MD file.");
    if (file.size > 10 * 1024 * 1024) throw new ApiError(413, "Files must be 10 MB or smaller.");
    const now = new Date().toISOString();
    const row: DocumentRow = {
      id: `d-new-${docSeq++}`,
      title: file.name,
      source_type: ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "text",
      source_url: null,
      status: "queued",
      error: null,
      chunk_count: 0,
      attempts: 1,
      created_at: now,
      updated_at: now,
    };
    documents[tid].unshift(row);
    runPipeline(row);
    return { ...row };
  },
  async addUrl(tid, url) {
    await latency();
    requireRole(tid, "owner", "admin");
    if (!/^https?:\/\//.test(url)) throw new ApiError(400, "Use an http:// or https:// URL.");
    const now = new Date().toISOString();
    const row: DocumentRow = {
      id: `d-new-${docSeq++}`,
      title: url.replace(/^https?:\/\//, ""),
      source_type: "url",
      source_url: url,
      status: "queued",
      error: null,
      chunk_count: 0,
      attempts: 1,
      created_at: now,
      updated_at: now,
    };
    documents[tid].unshift(row);
    runPipeline(row, /404|missing/.test(url));
    return { ...row };
  },
  async reindex(tid, id) {
    await latency();
    requireRole(tid, "owner", "admin");
    const row = documents[tid].find((d) => d.id === id);
    if (!row) throw new ApiError(404, "Document not found.");
    row.status = "queued";
    row.error = null;
    runPipeline(row, row.id === "d-nw-dealer");
  },
  async deleteDocument(tid, id) {
    await latency();
    requireRole(tid, "owner", "admin");
    documents[tid] = documents[tid].filter((d) => d.id !== id);
  },
  async documentEvents(tid, onList, signal) {
    currentRole(tid);
    let last = "";
    while (!signal.aborted) {
      const snapshot = JSON.stringify(documents[tid]);
      if (snapshot !== last) {
        last = snapshot;
        onList(JSON.parse(snapshot) as DocumentRow[]);
      }
      await wait(500);
    }
  },
  async conversations(tid, filter) {
    await latency();
    currentRole(tid);
    const t = tenantOr404(tid);
    return conversations
      .filter((c) => c.tenant_id === tid)
      .map(summary)
      .filter((c) =>
        filter === "escalated"
          ? c.status === "escalated"
          : filter === "low_confidence"
            ? c.confidence !== null && c.confidence !== undefined && c.confidence < t.confidence_threshold
            : true,
      )
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
  },
  async conversation(tid, id) {
    await latency();
    currentRole(tid);
    const c = conversations.find((x) => x.id === id && x.tenant_id === tid);
    if (!c) throw new ApiError(404, "Conversation not found.");
    const t = c.ticket_id ? tickets.find((x) => x.id === c.ticket_id) ?? null : null;
    return { ...summary(c), messages: c.messages.map((x) => ({ ...x })), ticket_full: t };
  },
  async reply(tid, id, content) {
    await latency();
    currentRole(tid);
    const c = conversations.find((x) => x.id === id && x.tenant_id === tid);
    if (!c) throw new ApiError(404, "Conversation not found.");
    const s = getSession();
    const msg: Message = {
      id: `m-reply-${Date.now()}`,
      role: "human_agent",
      content,
      redactions: [],
      intent: null,
      confidence: null,
      confidence_breakdown: null,
      citations: [],
      escalated: false,
      author_user_id: s?.user.id ?? null,
      author_name: s?.user.name ?? null,
      created_at: new Date().toISOString(),
    };
    c.messages.push(msg);
    c.last_message_at = msg.created_at;
    return msg;
  },
  async tickets(tid) {
    await latency();
    currentRole(tid);
    return tickets.filter((t) => t.tenant_id === tid).map((t) => ({ ...t }));
  },
  async updateTicket(tid, id, patch) {
    await latency();
    currentRole(tid);
    const t = tickets.find((x) => x.id === id && x.tenant_id === tid);
    if (!t) throw new ApiError(404, "Ticket not found.");
    Object.assign(t, patch, { updated_at: new Date().toISOString() });
    return { ...t };
  },
  async analytics(tid, days) {
    await latency();
    currentRole(tid);
    return analyticsFor(tid, days);
  },
  async audit(tid) {
    await latency();
    requireRole(tid, "owner", "admin");
    return auditLog.filter((a) => a.tenant_id === tid);
  },
  async widgetConfig(key) {
    await latency();
    const t = tenants.find((x) => x.widget_key === key);
    if (!t) throw new ApiError(404, "Unknown widget key.");
    return { tenant_name: t.name, brand_color: t.brand_color, greeting: greetings[t.id] };
  },
  widgetChat(body, signal) {
    return mockChat(body.key, body.conversation_id, body.message, signal);
  },
};

