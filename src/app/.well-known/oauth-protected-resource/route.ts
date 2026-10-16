import { origin, READ } from "@/lib/auth";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({
    resource: origin() + "/mcp",
    authorization_servers: [origin()],
    scopes_supported: [READ],
    bearer_methods_supported: ["header"],
    resource_name: "Content Hub 私有内容仓库",
  });
}
