import { agentHttp } from "@/lib/agent/transport";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = agentHttp,
  POST = agentHttp,
  PATCH = agentHttp,
  PUT = agentHttp,
  DELETE = agentHttp;
