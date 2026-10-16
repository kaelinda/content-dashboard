import { origin, READ } from "@/lib/auth";
export const dynamic = "force-dynamic";
export function GET() {
  const base = origin();
  return Response.json({
    issuer: base,
    authorization_endpoint: base + "/oauth/authorize",
    token_endpoint: base + "/oauth/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [READ],
  });
}
