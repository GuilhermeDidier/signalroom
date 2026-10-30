-- Signalroom schema. Unqualified names: runs in `public` locally and in a
-- dedicated schema on hosted Postgres (role search_path = <schema>, extensions).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  widget_key text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  brand_color text NOT NULL DEFAULT '#1f5fd1',
  confidence_threshold numeric(3,2) NOT NULL DEFAULT 0.55
    CHECK (confidence_threshold BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'agent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'agent')),
  token text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id),
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('pdf', 'docx', 'url', 'text')),
  source_url text,
  mime text,
  content bytea,                       -- raw upload (demo: kept in Postgres, max 10 MB)
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'parsing', 'chunking', 'embedding', 'indexed', 'failed')),
  error text,
  chunk_count integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_tenant_idx ON documents (tenant_id, created_at DESC);

CREATE TABLE chunks (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  heading text,
  page integer,
  content text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
    setweight(to_tsvector('english', content), 'B')
  ) STORED,
  embedding vector(384) NOT NULL
);
CREATE INDEX chunks_tenant_idx ON chunks (tenant_id);
CREATE INDEX chunks_document_idx ON chunks (document_id);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'widget' CHECK (channel IN ('widget', 'dashboard')),
  visitor_id text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'escalated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_tenant_idx ON conversations (tenant_id, last_message_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'human_agent')),
  content text NOT NULL,               -- user text is stored ALREADY REDACTED
  redactions jsonb NOT NULL DEFAULT '[]',
  intent text,
  confidence numeric(4,3),
  confidence_breakdown jsonb,
  citations jsonb NOT NULL DEFAULT '[]',
  escalated boolean NOT NULL DEFAULT false,
  author_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
CREATE INDEX messages_tenant_idx ON messages (tenant_id, created_at DESC);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number serial,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  subject text NOT NULL,
  summary text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  source text NOT NULL CHECK (source IN ('ai_tool', 'escalation', 'human')),
  reason text,
  assignee_user_id uuid REFERENCES users(id),
  notification_status text NOT NULL DEFAULT 'pending'
    CHECK (notification_status IN ('pending', 'sent', 'skipped', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_tenant_idx ON tickets (tenant_id, created_at DESC);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'ai', 'system', 'widget')),
  actor_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_log (tenant_id, created_at DESC);

-- Append-only: the audit log can be inserted into, never changed.
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Global daily LLM spend guard for the public demo.
CREATE TABLE llm_usage (
  day date NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tenant_id)
);
