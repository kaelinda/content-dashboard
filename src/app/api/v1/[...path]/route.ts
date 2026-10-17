import { handleV1 } from "@/lib/agent/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleV1;
export const POST = handleV1;
export const PATCH = handleV1;
export const PUT = handleV1;
export const DELETE = handleV1;
