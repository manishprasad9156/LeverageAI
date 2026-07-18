-- LeverageAI — Postgres schema
-- Apply via: psql $DATABASE_URL -f src/lib/db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical         text NOT NULL,
  job_spec         jsonb NOT NULL DEFAULT '{}'::jsonb,
  frozen_job_spec  jsonb NULL,
  status           text NOT NULL DEFAULT 'draft',
  confirmed        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vendor_id                   text NOT NULL,
  vendor_name                 text NOT NULL,
  status                      text NOT NULL DEFAULT 'pending',
  outcome_type                text NULL,
  current_total               numeric NULL,
  callback_window             text NULL,
  negotiator_conversation_id  text NULL,
  counter_conversation_id     text NULL,
  audio_url                   text NULL,
  recording_note              text NULL,
  last_event_at               timestamptz NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_job_id_idx ON sessions(job_id);

CREATE TABLE IF NOT EXISTS quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  vendor_id   text NOT NULL,
  line_items  jsonb NOT NULL DEFAULT '[]'::jsonb,
  total       numeric NOT NULL,
  red_flag    boolean NOT NULL DEFAULT false,
  notes       text NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_job_id_idx ON quotes(job_id);
CREATE INDEX IF NOT EXISTS quotes_session_id_idx ON quotes(session_id);

CREATE TABLE IF NOT EXISTS transcript_events (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ts_ms       int NOT NULL DEFAULT 0,
  speaker     text NOT NULL,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transcript_events_session_id_idx ON transcript_events(session_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  job_id      uuid NULL REFERENCES jobs(id) ON DELETE SET NULL,
  tool_name   text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_calls_session_id_idx ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS tool_calls_job_id_idx ON tool_calls(job_id);

CREATE TABLE IF NOT EXISTS intake_drafts (
  id          uuid PRIMARY KEY,
  vertical    text NOT NULL,
  job_spec    jsonb NULL,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_drafts_vertical_status_idx
  ON intake_drafts(vertical, status, updated_at DESC);

-- Idempotent migrations for existing DBs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS frozen_job_spec jsonb NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS negotiator_conversation_id text NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS counter_conversation_id text NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS audio_url text NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS recording_note text NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_event_at timestamptz NULL;
