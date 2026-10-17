import { openapi } from "@/lib/agent/openapi";
export function GET() {
  return Response.json(openapi(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
