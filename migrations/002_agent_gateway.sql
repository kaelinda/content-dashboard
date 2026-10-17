-- Additive migration. Existing rows stay in the private default project.
CREATE TABLE hub_projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  change_seq BIGINT NOT NULL DEFAULT 0 CHECK(change_seq>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO hub_projects(id,name) VALUES('default','默认内容项目');
CREATE TABLE hub_agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  project_ids TEXT[] NOT NULL, scopes TEXT[] NOT NULL,
  revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sources ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES hub_projects(id);
ALTER TABLE contents ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES hub_projects(id);
ALTER TABLE assets ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES hub_projects(id);
-- Deduplicate bytes globally in blob storage, but never share resource metadata across projects.
ALTER TABLE sources DROP CONSTRAINT sources_sha256_key;
ALTER TABLE sources ADD CONSTRAINT sources_project_sha_key UNIQUE(project_id,sha256);
ALTER TABLE assets DROP CONSTRAINT assets_sha256_key;
ALTER TABLE assets ADD CONSTRAINT assets_project_sha_key UNIQUE(project_id,sha256);
CREATE INDEX ON sources(project_id,fetched_at,id);
CREATE INDEX ON contents(project_id,created_at,id);
CREATE TABLE hub_files (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES hub_projects(id),
  name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>=0),
  sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  asset_id TEXT REFERENCES assets(id), created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE artifacts ADD COLUMN external_file_id TEXT REFERENCES hub_files(id);
CREATE TRIGGER frozen_hub_files BEFORE UPDATE OR DELETE ON hub_files FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TABLE hub_requests (
  principal_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES hub_projects(id),
  idempotency_key TEXT NOT NULL, operation TEXT NOT NULL, request_hash TEXT NOT NULL,
  response JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(principal_id,project_id,idempotency_key)
);
-- Project counters are allocated while holding the project row lock through commit.
-- This prevents out-of-order sequence commits from making an incremental consumer miss changes.
CREATE TABLE hub_changes (
  project_id TEXT NOT NULL REFERENCES hub_projects(id), seq BIGINT NOT NULL,
  type TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
  version INTEGER, actor_id TEXT NOT NULL, request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(project_id,seq)
);
CREATE TRIGGER frozen_hub_changes BEFORE UPDATE OR DELETE ON hub_changes FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TABLE hub_calls (
  request_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, operation TEXT NOT NULL,
  project_id TEXT, status INTEGER NOT NULL, code TEXT, replayed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON hub_calls(created_at DESC);
CREATE TRIGGER frozen_hub_calls BEFORE UPDATE OR DELETE ON hub_calls FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
