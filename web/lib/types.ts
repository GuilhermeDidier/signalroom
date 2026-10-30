// Shapes from CONTRACT.md (api service). Numeric columns may arrive as strings
// from Postgres `numeric`; lib/api.ts normalizes them to numbers.

export type Role = "owner" | "admin" | "agent";

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Membership {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role: Role;
}

export interface Me {
  user: User;
  memberships: Membership[];
}

export interface LoginPayload extends Me {
  token: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  widget_key: string;
  allowed_origins: string[];
  brand_color: string;
  confidence_threshold: number;
}

export interface Member {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  created_at?: string;
}

export interface Invite {
  id: string;
  email: string;
  role: Exclude<Role, "owner">;
  token?: string;
  invite_url?: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface PublicInvite {
  email: string;
  role: Role;
  tenant_name: string;
  expires_at?: string;
  accepted_at?: string | null;
}

export type DocStatus = "queued" | "parsing" | "chunking" | "embedding" | "indexed" | "failed";

export interface DocumentRow {
  id: string;
  title: string;
  source_type: "pdf" | "docx" | "url" | "text";
  source_url: string | null;
  mime?: string | null;
  status: DocStatus;
  error: string | null;
  chunk_count: number;
  attempts?: number;
  created_at: string;
  updated_at: string;
}

export type Intent =
  | "how_to"
  | "billing"
  | "account"
  | "bug_report"
  | "complaint"
  | "human_request"
  | "out_of_scope"
  | "smalltalk";

export interface Redaction {
  type: "EMAIL" | "PHONE" | "CARD" | "SSN" | "IBAN" | "IP";
  count: number;
}

export interface Citation {
  n: number;
  chunk_id: string | number;
  document_id: string;
  document_title: string;
  heading: string | null;
  page: number | null;
  snippet: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "human_agent";
  content: string;
  redactions: Redaction[];
  intent: string | null;
  confidence: number | null;
  confidence_breakdown: Record<string, unknown> | null;
  citations: Citation[];
  escalated: boolean;
  author_user_id?: string | null;
  author_name?: string | null;
  created_at: string;
}

export type ConversationStatus = "open" | "resolved" | "escalated";

export interface TicketRef {
  id: string;
  number: number;
}

/** List item. Fields beyond the table columns are optional enrichments. */
export interface ConversationSummary {
  id: string;
  channel: "widget" | "dashboard";
  visitor_id: string | null;
  status: ConversationStatus;
  created_at: string;
  last_message_at: string;
  first_message?: string | null;
  intent?: string | null;
  confidence?: number | null;
  message_count?: number;
  ticket?: TicketRef | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: Message[];
  ticket_full?: Ticket | null;
}

export type TicketStatus = "open" | "pending" | "closed";
export type Priority = "low" | "normal" | "high" | "urgent";
export type NotificationStatus = "pending" | "sent" | "skipped" | "failed";

export interface Ticket {
  id: string;
  number: number;
  conversation_id: string | null;
  subject: string;
  summary: string;
  priority: Priority;
  status: TicketStatus;
  source: "ai_tool" | "escalation" | "human";
  reason: string | null;
  assignee_user_id: string | null;
  notification_status: NotificationStatus;
  created_at: string;
  updated_at: string;
}

export interface Analytics {
  conversations: number;
  ai_resolved: number;
  escalated: number;
  deflection_rate: number;
  low_confidence: number;
  avg_confidence: number;
  by_intent: { intent: string; count: number }[];
  daily: { day: string; conversations: number; escalated: number }[];
  top_unanswered: { question: string; confidence: number }[];
}

export interface AuditEntry {
  id: string | number;
  actor_type: "user" | "ai" | "system" | "widget";
  actor_id: string | null;
  actor_email?: string | null;
  actor_name?: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WidgetConfig {
  tenant_name: string;
  brand_color: string;
  greeting: string;
  allowed_origins?: string[];
}

/** Events of POST /widget/chat (ai events relayed + `saved`). */
export type ChatEvent =
  | { event: "meta"; data: { intent: string; intent_reason?: string; redacted_message: string; redactions: Redaction[] } }
  | { event: "token"; data: { text: string } }
  | { event: "tool"; data: { name: string; input: Record<string, unknown> } }
  | {
      event: "done";
      data: {
        answer: string;
        intent: string;
        confidence: number;
        confidence_breakdown: Record<string, unknown>;
        citations: Citation[];
        escalate: boolean;
        escalation_reason: string | null;
        ticket: { subject: string; summary: string; priority: Priority } | null;
      };
    }
  | { event: "saved"; data: { conversation_id: string; message_id: string; ticket: TicketRef | null } }
  | { event: "error"; data: { message: string } };
