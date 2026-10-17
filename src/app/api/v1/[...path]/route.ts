import { observeHttp } from "@/lib/observability";
import { agentHttp } from "@/lib/agent/transport";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const observed = (request: Request) => observeHttp(request, agentHttp);
export const GET = observed,
  POST = observed,
  PATCH = observed,
  PUT = observed,
  DELETE = observed;
