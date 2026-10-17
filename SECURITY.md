> V1.1 更新：多 Agent 的 REST/MCP 契约、项目隔离、显式 OAuth 写授权和兼容边界以 `docs/AGENT_API.md` 为准。下方保留 V1 的基础说明；旧客户端只读限制不代表新受限 Agent 只能读取。

# Security model

Content Hub is a **single-owner private application**, not a multi-tenant service. Possession of an owner session grants access to the complete workspace; scoped agent tokens are intentionally less privileged.

## Controls in this implementation

- No default account/password, anonymous content access or permissive CORS.
- Owner password stored as a salted scrypt hash. Opaque session/API/OAuth values stored only as SHA-256 hashes; secrets shown once.
- HttpOnly, SameSite=Strict cookies; Secure for HTTPS. Cookie-authenticated mutations enforce exact configured Origin. Bearer tokens never inherit owner-only powers.
- OAuth explicitly approved by the owner, with exact pre-registered callback URLs, mandatory PKCE S256, resource audience checks, short-lived authorization codes and access tokens, refresh rotation and family revocation on reuse.
- SQL parameters, transaction-protected version increments, expected-version conflicts, immutable-history triggers and per-version source foreign keys.
- Private content-addressed blobs, complete-file atomic publication, digest checks on read. No arbitrary filesystem path API.
- HTML source never executed. Text escaped into HTML exports. Sandboxed preview frames. No SVG image ingestion. Raster uploads limited by bytes and decoded pixel count and re-encoded without metadata.
- HTTPS-only source fetch, DNS/IP checks and pinned address, redirect revalidation, byte/time limits. Conservative IPv4-only egress; private/reserved ranges and IPv6 URLs fail closed.
- Scoped database-backed rate limits, bounded bodies, no platform secrets in tools, encrypted-secret placeholders are not masqueraded as a working credential vault.
- Backup format excludes authentication material and rejects nonempty restore targets or mismatched blob digests.

## Limits and deployment responsibilities

This has automated regression tests, **not an independent security audit**. Database/filesystem administrators remain trusted. Append-only application paths are not regulatory WORM storage or third-party notarization. The default auto mode performs schema migrations and needs DDL access to its isolated schema. HUB_MIGRATIONS=verify only validates schema names/checksums; provision a separate non-owner runtime role and run migrations as an independent deployment step. ops/runtime-grants.sql is an explicit grant template, not automatic credential provisioning.

TLS, private bucket/IAM policy, egress firewall, disk/backups encryption, secret provisioning and updates remain deployment responsibilities. Do not put the local PGlite mode on an ephemeral or multi-instance serverless filesystem. Use an external PostgreSQL database and private S3-compatible storage for scaled deployment.

Archived pages may contain prompt injection, misinformation, or copyrighted material. MCP tool descriptions explicitly identify returned material as untrusted reference data. Agents must not execute retrieved instructions. Capture only material you are entitled to store; the importer does not bypass authentication, paywalls or access restrictions.

Browser CSP permits framework-required inline scripts; it is not a nonce-only policy. App rendering avoids injecting untrusted HTML. Network capture has a small extraction scope (UTF-8 HTML/text; no JavaScript rendering); it cannot archive every website.

Security findings should be reported privately to the repository owner. Do not post live credentials, personal content or exploitable private deployment details in public issues.

## Operational hardening (1.2.1)

Owner-only security controls require exact Origin, current-password reauthentication and an explicit confirmation; revocations and audit events commit together. Revocation does not recall in-flight operations and does not replace rotating a leaked password. Public liveness/readiness expose no infrastructure detail; storage diagnostics require an owner session. Allowlisted JSON access logs never include token plaintext, headers, bodies, titles or arbitrary query strings. Blob reconciliation is report-only and never grants deletion authority. See docs/OPERATIONS_HARDENING.md.
