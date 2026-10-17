-- Additive migration. Existing V1 records remain in the default project.
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
INSERT INTO projects(id,name) VALUES('default','默认项目');
ALTER TABLE contents ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE sources ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE assets ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default' REFERENCES projects(id);
ALTER TABLE sources DROP CONSTRAINT sources_sha256_key;
ALTER TABLE assets DROP CONSTRAINT assets_sha256_key;
ALTER TABLE sources ADD UNIQUE(project_id,sha256);
ALTER TABLE assets ADD UNIQUE(project_id,sha256);
CREATE INDEX ON contents(project_id,id);
CREATE INDEX ON sources(project_id,id);
CREATE TABLE agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, scopes TEXT[] NOT NULL,
  project_ids TEXT[] NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE agent_idempotency (
  principal_id TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL,
  response JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(principal_id,key)
);
CREATE TABLE agent_files (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>=0),
  sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  actor TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id,sha256,name,mime)
);
CREATE TRIGGER frozen_agent_files BEFORE UPDATE OR DELETE ON agent_files FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
-- The counter lock is held through COMMIT; consumers cannot skip a late commit.
CREATE TABLE agent_change_clock (singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton), value BIGINT NOT NULL DEFAULT 0);
INSERT INTO agent_change_clock(singleton) VALUES(true);
CREATE TABLE agent_changes (
  id BIGINT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL, resource_id TEXT NOT NULL, version INTEGER,
  operation TEXT NOT NULL, actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON agent_changes(project_id,id);
CREATE TRIGGER frozen_agent_changes BEFORE UPDATE OR DELETE ON agent_changes FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TABLE agent_requests (
  request_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, operation TEXT NOT NULL,
  status INTEGER NOT NULL, code TEXT, duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON agent_requests(created_at DESC);
