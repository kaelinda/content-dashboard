import { openApiDocument } from "@/lib/agent/openapi";
export const dynamic = "force-static";
export function GET() {
  return Response.json(openApiDocument());
}
