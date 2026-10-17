-- Run with psql as the migration/schema owner, in a dedicated Hub schema.
-- The runtime role must already exist, not own objects, and not inherit the owner role.
-- psql -v ON_ERROR_STOP=1 -v schema=public -v runtime_role=hub_runtime -f ops/runtime-grants.sql
-- Database CONNECT and credentials are provisioned separately by the operator.
BEGIN;
REVOKE CREATE ON SCHEMA :"schema" FROM PUBLIC;
GRANT USAGE ON SCHEMA :"schema" TO :"runtime_role";
GRANT SELECT ON ALL TABLES IN SCHEMA :"schema" TO :"runtime_role";
GRANT INSERT ON
 :"schema".sources, :"schema".source_locations, :"schema".assets, :"schema".source_images,
 :"schema".contents, :"schema".content_versions, :"schema".content_blocks, :"schema".content_sources,
 :"schema".artifacts, :"schema".publications, :"schema".events, :"schema".tokens, :"schema".rate_limits,
 :"schema".projects, :"schema".agents, :"schema".agent_idempotency, :"schema".agent_files,
 :"schema".agent_changes, :"schema".agent_requests TO :"runtime_role";
GRANT UPDATE ON :"schema".contents, :"schema".publications, :"schema".tokens, :"schema".rate_limits,
 :"schema".agents, :"schema".agent_idempotency, :"schema".agent_change_clock TO :"runtime_role";
GRANT DELETE ON :"schema".rate_limits TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA :"schema" TO :"runtime_role";
COMMIT;
-- No DDL, schema_migrations writes, history updates/deletes, TRUNCATE or role management.
-- Reapply reviewed grants after adding a migration. Do not grant blanket future DML.
