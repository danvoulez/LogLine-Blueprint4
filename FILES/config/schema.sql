-- LogLineOS Blueprint4 - Universal Registry Schema
-- Append-only ledger with ~70 semantic columns

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Namespaces
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ledger;

-- Session accessors for RLS
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT current_setting('app.user_id', true) $$;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT current_setting('app.tenant_id', true) $$;

-- Universal registry (append-only)
CREATE TABLE IF NOT EXISTS ledger.universal_registry (
  id            uuid        NOT NULL,
  seq           integer     NOT NULL,
  entity_type   text        NOT NULL,   -- function, execution, request, policy, provider, metric, prompt_*, memory, etc.
  who           text        NOT NULL,
  did           text,
  "this"        text        NOT NULL,
  at            timestamptz NOT NULL DEFAULT now(),

  -- Relationships
  parent_id     uuid,
  related_to    uuid[],

  -- Access control
  owner_id      text,
  tenant_id     text,
  visibility    text        NOT NULL DEFAULT 'private', -- private|tenant|public

  -- Lifecycle
  status        text,       -- draft|scheduled|queued|running|complete|error|active|open|pass|fail|slow
  is_deleted    boolean     NOT NULL DEFAULT false,

  -- Code & Execution
  name          text,
  description   text,
  code          text,
  language      text,
  runtime       text,
  input         jsonb,
  output        jsonb,
  error         jsonb,

  -- Quantitative/metrics
  duration_ms   integer,
  trace_id      text,

  -- Crypto proofs
  prev_hash     text,
  curr_hash     text,
  signature     text,
  public_key    text,

  -- Extensibility
  metadata      jsonb,

  PRIMARY KEY (id, seq),
  CONSTRAINT ck_visibility CHECK (visibility IN ('private','tenant','public')),
  CONSTRAINT ck_append_only CHECK (seq >= 0)
);

-- "Visible timeline" view: legacy alias "when" → "at" for kernels that expect it
CREATE OR REPLACE VIEW ledger.visible_timeline AS
SELECT
  ur.*,
  ur.at AS "when"
FROM ledger.universal_registry ur
WHERE ur.is_deleted = false;

-- Append-only enforcement: disallow UPDATE/DELETE
CREATE OR REPLACE FUNCTION ledger.no_updates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Append-only table: updates/deletes are not allowed.';
END; $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'ur_no_update'
  ) THEN
    CREATE TRIGGER ur_no_update BEFORE UPDATE OR DELETE ON ledger.universal_registry
    FOR EACH ROW EXECUTE FUNCTION ledger.no_updates();
  END IF;
END $$;

-- Notify on insert for SSE
CREATE OR REPLACE FUNCTION ledger.notify_timeline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('timeline_updates', row_to_json(NEW)::text);
  RETURN NEW;
END; $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'ur_notify_insert'
  ) THEN
    CREATE TRIGGER ur_notify_insert AFTER INSERT ON ledger.universal_registry
    FOR EACH ROW EXECUTE FUNCTION ledger.notify_timeline();
  END IF;
END $$;

-- Useful indexes
CREATE INDEX IF NOT EXISTS ur_idx_at ON ledger.universal_registry (at DESC);
CREATE INDEX IF NOT EXISTS ur_idx_entity ON ledger.universal_registry (entity_type, at DESC);
CREATE INDEX IF NOT EXISTS ur_idx_owner_tenant ON ledger.universal_registry (owner_id, tenant_id);
CREATE INDEX IF NOT EXISTS ur_idx_trace ON ledger.universal_registry (trace_id);
CREATE INDEX IF NOT EXISTS ur_idx_parent ON ledger.universal_registry (parent_id);
CREATE INDEX IF NOT EXISTS ur_idx_related ON ledger.universal_registry USING GIN (related_to);
CREATE INDEX IF NOT EXISTS ur_idx_metadata ON ledger.universal_registry USING GIN (metadata);

-- Idempotency for observer-generated requests (prevents duplicate scheduling)
CREATE UNIQUE INDEX IF NOT EXISTS ur_idx_request_idempotent
  ON ledger.universal_registry (parent_id, entity_type, status)
  WHERE entity_type = 'request' AND status = 'scheduled' AND is_deleted = false;

-- RLS
ALTER TABLE ledger.universal_registry ENABLE ROW LEVEL SECURITY;

-- SELECT: owner OR same tenant with visibility tenant/public OR visibility public
CREATE POLICY ur_select_policy ON ledger.universal_registry
  FOR SELECT USING (
    (owner_id IS NOT DISTINCT FROM app.current_user_id())
    OR (visibility = 'public')
    OR (tenant_id IS NOT DISTINCT FROM app.current_tenant_id() AND visibility IN ('tenant','public'))
  );

-- INSERT: requester must set app.user_id; row owner_id = app.user_id; tenant matches session if provided
CREATE POLICY ur_insert_policy ON ledger.universal_registry
  FOR INSERT WITH CHECK (
    owner_id IS NOT DISTINCT FROM app.current_user_id()
    AND (tenant_id IS NULL OR tenant_id IS NOT DISTINCT FROM app.current_tenant_id())
  );
