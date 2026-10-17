import { observeHttp } from "@/lib/observability";
import { exchange } from "@/lib/oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => observeHttp(request, exchange);
