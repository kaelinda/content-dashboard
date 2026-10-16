CREATE TABLE sources (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, original_url TEXT,
  sha256 TEXT NOT NULL UNIQUE CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  markdown TEXT NOT NULL, mime TEXT NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'medium' CHECK (trust_level IN ('high','medium','low')),
  meta JSONB NOT NULL DEFAULT '{}', fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE source_locations (
  source_id TEXT NOT NULL REFERENCES sources(id), url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(source_id,url)
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  mime TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes >= 0),
  width INTEGER NOT NULL, height INTEGER NOT NULL, name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE source_images (
  source_id TEXT NOT NULL REFERENCES sources(id), asset_id TEXT NOT NULL REFERENCES assets(id),
  origin_url TEXT, alt TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'image',
  PRIMARY KEY(source_id, asset_id)
);
CREATE TABLE contents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','ready','archived')),
  tags TEXT[] NOT NULL DEFAULT '{}', current_version INTEGER NOT NULL CHECK(current_version>0),
  search_text TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE content_versions (
  content_id TEXT NOT NULL REFERENCES contents(id), version INTEGER NOT NULL CHECK(version>0),
  title TEXT NOT NULL, status TEXT NOT NULL, tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(content_id,version)
);
CREATE TABLE content_blocks (
  content_id TEXT NOT NULL, version INTEGER NOT NULL, seq INTEGER NOT NULL CHECK(seq>=0),
  type TEXT NOT NULL CHECK(type IN ('heading','paragraph','quote','code','callout','image_prompt','narration','image')),
  payload JSONB NOT NULL, PRIMARY KEY(content_id,version,seq),
  FOREIGN KEY(content_id,version) REFERENCES content_versions(content_id,version)
);
CREATE TABLE content_sources (
  content_id TEXT NOT NULL, version INTEGER NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id),
  role TEXT NOT NULL DEFAULT 'main', PRIMARY KEY(content_id,version,source_id),
  FOREIGN KEY(content_id,version) REFERENCES content_versions(content_id,version)
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, content_id TEXT NOT NULL, content_version INTEGER NOT NULL,
  title TEXT NOT NULL, kind TEXT NOT NULL, variant TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), bytes INTEGER NOT NULL CHECK(bytes>=0),
  mime TEXT NOT NULL, recipe JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(content_id,content_version) REFERENCES content_versions(content_id,version),
  UNIQUE(content_id,content_version,kind,variant,sha256)
);
CREATE TABLE publications (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id), platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','submitted','published','rejected','removed')),
  url TEXT, note TEXT NOT NULL DEFAULT '', published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, actor TEXT NOT NULL,
  subject_id TEXT, payload JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON events(created_at DESC);
CREATE INDEX ON contents(updated_at DESC);
CREATE INDEX ON artifacts(content_id, content_version);
CREATE INDEX ON publications(artifact_id);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '', scopes TEXT[] NOT NULL DEFAULT '{}', meta JSONB NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON tokens(expires_at);
CREATE TABLE rate_limits (key TEXT NOT NULL, window_start BIGINT NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(key,window_start));
CREATE OR REPLACE FUNCTION reject_history_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Immutable history: insert a new version instead'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER frozen_artifacts BEFORE UPDATE OR DELETE ON artifacts FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER frozen_events BEFORE UPDATE OR DELETE ON events FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER frozen_versions BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER frozen_blocks BEFORE UPDATE OR DELETE ON content_blocks FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER frozen_sources_links BEFORE UPDATE OR DELETE ON content_sources FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

-- Original snapshots and normalized image assets are immutable as well.
CREATE TRIGGER frozen_source_snapshot BEFORE UPDATE OF sha256, mime, fetched_at OR DELETE ON sources FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER frozen_assets BEFORE UPDATE OR DELETE ON assets FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
