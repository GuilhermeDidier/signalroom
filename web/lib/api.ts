import { API_URL, MOCK } from "./config";
import { getToken, setSession } from "./session";
import { readSse } from "./sse";
import { ApiError } from "./errors";
import { mockApi } from "./mock/server";
import type {
  Analytics,
  AuditEntry,
  ChatEvent,
  ConversationDetail,
  ConversationSummary,
  DocumentRow,
  Invite,
  LoginPayload,
  Me,
  Member,
  Message,
  PublicInvite,
  Role,
  Tenant,
  Ticket,
  TicketStatus,
  WidgetConfig,
} from "./types";

export { ApiError };

export type ConversationFilter = "all" | "low_confidence" | "escalated";

export interface SettingsPatch {
  confidence_threshold?: number;
  allowed_origins?: string[];
  brand_color?: string;
}

export interface WidgetChatBody {
  key: string;
  conversation_id?: string;
  visitor_id: string;
  message: string;
}

export interface Api {
  health(): Promise<boolean>;
  login(email: string, password: string): Promise<LoginPayload>;
  demoLogin(tenantSlug: string, role: Role): Promise<LoginPayload>;
  me(): Promise<Me>;
  tenant(tid: string): Promise<Tenant>;
  updateSettings(tid: string, patch: SettingsPatch): Promise<Tenant>;
  members(tid: string): Promise<Member[]>;
  changeRole(tid: string, uid: string, role: Role): Promise<Member>;
  invites(tid: string): Promise<Invite[]>;
  createInvite(tid: string, email: string, role: Exclude<Role, "owner">): Promise<{ invite_url: string }>;
  publicInvite(token: string): Promise<PublicInvite>;
  acceptInvite(token: string, name: string, password: string): Promise<LoginPayload>;
  documents(tid: string): Promise<DocumentRow[]>;
  uploadDocument(tid: string, file: File): Promise<DocumentRow>;
  addUrl(tid: string, url: string): Promise<DocumentRow>;
  reindex(tid: string, id: string): Promise<void>;
  deleteDocument(tid: string, id: string): Promise<void>;
  /** Resolves when the stream ends; calls onList for every `documents` event. */
  documentEvents(tid: string, onList: (docs: DocumentRow[]) => void, signal: AbortSignal): Promise<void>;
  conversations(tid: string, filter: ConversationFilter): Promise<ConversationSummary[]>;
  conversation(tid: string, id: string): Promise<ConversationDetail>;
  reply(tid: string, id: string, content: string): Promise<Message>;
  tickets(tid: string): Promise<Ticket[]>;
  updateTicket(tid: string, id: string, patch: { status?: TicketStatus; assignee_user_id?: string | null }): Promise<Ticket>;
  analytics(tid: string, days: number): Promise<Analytics>;
  audit(tid: string): Promise<AuditEntry[]>;
  widgetConfig(key: string): Promise<WidgetConfig>;
  widgetChat(body: WidgetChatBody, signal: AbortSignal): AsyncGenerator<ChatEvent>;
}

// ---------- normalization (Postgres numeric → string) ----------

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Lists may come bare or wrapped (`{items}`, `{data}`, or `{<name>}`). */
function list<T>(res: unknown, key: string): T[] {
  if (Array.isArray(res)) return res as T[];
  const o = (res ?? {}) as Record<string, unknown>;
  return arr<T>(o[key] ?? o.items ?? o.data);
}

export function normTenant(t: Tenant): Tenant {
  return { ...t, confidence_threshold: num(t.confidence_threshold), allowed_origins: arr<string>(t.allowed_origins) };
}

export function normMessage(m: Message): Message {
  return {
    ...m,
    confidence: numOrNull(m.confidence),
    redactions: arr(m.redactions),
    citations: arr(m.citations),
    escalated: Boolean(m.escalated),
  };
}

/** The API names list enrichments first_question / last_intent / last_confidence. */
function normConversation(c: ConversationSummary): ConversationSummary {
  const raw = c as ConversationSummary & {
    first_question?: string | null;
    last_intent?: string | null;
    last_confidence?: number | string | null;
  };
  return {
    ...c,
    first_message: c.first_message ?? raw.first_question ?? null,
    intent: c.intent ?? raw.last_intent ?? null,
    confidence: numOrNull(c.confidence ?? raw.last_confidence),
    ticket: c.ticket ?? null,
  };
}

function normMember(m: Member & { id?: string }): Member {
  return { ...m, user_id: m.user_id ?? m.id ?? "" };
}

function normAnalytics(a: Analytics): Analytics {
  return {
    ...a,
    conversations: num(a.conversations),
    ai_resolved: num(a.ai_resolved),
    escalated: num(a.escalated),
    deflection_rate: num(a.deflection_rate),
    low_confidence: num(a.low_confidence),
    avg_confidence: num(a.avg_confidence),
    by_intent: arr<{ intent: string; count: number }>(a.by_intent).map((x) => ({ ...x, count: num(x.count) })),
    daily: arr<{ day: string; conversations: number; escalated: number }>(a.daily).map((d) => ({
      ...d,
      conversations: num(d.conversations),
      escalated: num(d.escalated),
    })),
    top_unanswered: arr<{ question: string; confidence: number }>(a.top_unanswered).map((q) => ({
      ...q,
      confidence: num(q.confidence),
    })),
  };
}

// ---------- HTTP ----------

async function request<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init.auth !== false) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "The Signalroom API is not reachable right now.");
  }
  if (res.status === 401 && init.auth !== false) {
    setSession(null);
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string | string[]; error?: string };
      const m = Array.isArray(body.message) ? body.message.join(" ") : body.message;
      if (m) message = m;
      else if (body.error) message = body.error;
    } catch {
      // non-JSON error body: keep the generic message with the status code
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const json = (body: unknown) => JSON.stringify(body);

const httpApi: Api = {
  async health() {
    try {
      const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
      return res.ok;
    } catch {
      return false;
    }
  },
  login: (email, password) =>
    request<LoginPayload>("/auth/login", { method: "POST", body: json({ email, password }), auth: false }),
  demoLogin: (tenant_slug, role) =>
    request<LoginPayload>("/auth/demo", { method: "POST", body: json({ tenant_slug, role }), auth: false }),
  me: () => request<Me>("/me"),
  tenant: async (tid) => normTenant(await request<Tenant>(`/tenants/${tid}`)),
  updateSettings: async (tid, patch) =>
    normTenant(await request<Tenant>(`/tenants/${tid}/settings`, { method: "PATCH", body: json(patch) })),
  members: async (tid) => list<Member>(await request(`/tenants/${tid}/members`), "members").map(normMember),
  changeRole: async (tid, uid, role) =>
    normMember(await request<Member>(`/tenants/${tid}/members/${uid}`, { method: "PATCH", body: json({ role }) })),
  invites: async (tid) => list<Invite>(await request(`/tenants/${tid}/invites`), "invites"),
  createInvite: (tid, email, role) =>
    request(`/tenants/${tid}/invites`, { method: "POST", body: json({ email, role }) }),
  publicInvite: (token) => request<PublicInvite>(`/invites/${encodeURIComponent(token)}`, { auth: false }),
  acceptInvite: (token, name, password) =>
    request<LoginPayload>(`/invites/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: json({ name, password }),
      auth: false,
    }),
  documents: async (tid) => list<DocumentRow>(await request(`/tenants/${tid}/documents`), "documents"),
  uploadDocument: (tid, file) => {
    const form = new FormData();
    form.append("file", file);
    return request<DocumentRow>(`/tenants/${tid}/documents`, { method: "POST", body: form });
  },
  addUrl: (tid, url) => request<DocumentRow>(`/tenants/${tid}/documents`, { method: "POST", body: json({ url }) }),
  reindex: (tid, id) => request<void>(`/tenants/${tid}/documents/${id}/reindex`, { method: "POST" }),
  deleteDocument: (tid, id) => request<void>(`/tenants/${tid}/documents/${id}`, { method: "DELETE" }),
  async documentEvents(tid, onList, signal) {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(`${API_URL}/tenants/${tid}/documents/events`, { headers, signal, cache: "no-store" });
    } catch (e) {
      if (signal.aborted) return;
      throw e instanceof Error ? new ApiError(0, e.message) : new ApiError(0, "Stream failed.");
    }
    if (res.status === 401) setSession(null); // same as request(): the shell redirects to /login
    if (!res.ok || !res.body) throw new ApiError(res.status, `Live status stream failed (${res.status}).`);
    for await (const msg of readSse(res.body)) {
      if (msg.event !== "documents") continue;
      onList(list<DocumentRow>(JSON.parse(msg.data), "documents"));
    }
  },
  conversations: async (tid, filter) =>
    list<ConversationSummary>(await request(`/tenants/${tid}/conversations?filter=${filter}`), "conversations").map(
      normConversation,
    ),
  async conversation(tid, id) {
    const res = await request<Record<string, unknown>>(`/tenants/${tid}/conversations/${id}`);
    const base = (res.conversation ?? res) as ConversationDetail;
    const messages = arr<Message>(res.messages ?? base.messages).map(normMessage);
    const tickets = arr<Ticket>(res.tickets);
    const ticketRaw = (tickets[tickets.length - 1] ?? res.ticket ?? base.ticket) as (Ticket & { number: number }) | null | undefined;
    return {
      ...normConversation(base),
      messages,
      ticket: ticketRaw ? { id: ticketRaw.id, number: ticketRaw.number } : null,
      ticket_full: ticketRaw && "subject" in ticketRaw ? ticketRaw : null,
    } as ConversationDetail;
  },
  reply: async (tid, id, content) =>
    normMessage(await request<Message>(`/tenants/${tid}/conversations/${id}/reply`, { method: "POST", body: json({ content }) })),
  tickets: async (tid) => list<Ticket>(await request(`/tenants/${tid}/tickets`), "tickets"),
  updateTicket: (tid, id, patch) =>
    request<Ticket>(`/tenants/${tid}/tickets/${id}`, { method: "PATCH", body: json(patch) }),
  analytics: async (tid, days) => normAnalytics(await request<Analytics>(`/tenants/${tid}/analytics?days=${days}`)),
  audit: async (tid) => list<AuditEntry>(await request(`/tenants/${tid}/audit`), "entries"),
  widgetConfig: (key) => request<WidgetConfig>(`/widget/config?key=${encodeURIComponent(key)}`, { auth: false }),
  async *widgetChat(body, signal) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/widget/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: json(body),
        signal,
      });
    } catch {
      throw new ApiError(0, "The assistant is not reachable right now.");
    }
    if (!res.ok || !res.body) {
      let message = `Chat failed (${res.status}).`;
      try {
        const b = (await res.json()) as { message?: string };
        if (b.message) message = b.message;
      } catch {
        // keep generic message
      }
      throw new ApiError(res.status, message);
    }
    for await (const msg of readSse(res.body)) {
      yield { event: msg.event, data: JSON.parse(msg.data) } as ChatEvent;
    }
  },
};

export const api: Api = MOCK ? mockApi : httpApi;
