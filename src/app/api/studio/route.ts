import { authenticate } from "@/lib/auth";
import { database } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";
import { HubError, validId } from "@/lib/domain";
import { sourceById } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-only read model. This is deliberately not part of the Agent tool surface. */
export async function GET(request: Request) {
  try {
    await authenticate(request, false, true);
    const url = new URL(request.url);
    for (const key of url.searchParams.keys()) {
      if (!["source"].includes(key) || url.searchParams.getAll(key).length > 1)
        throw new HubError("不支持的查询参数");
    }
    const db = await database();
    if (url.searchParams.has("source")) {
      const id = validId(url.searchParams.get("source"));
      const source = await sourceById(id);
      const related = await db.query(
        `SELECT c.id,c.title,c.current_version,c.status
        FROM contents c JOIN content_sources cs ON cs.content_id=c.id AND cs.version=c.current_version
        WHERE cs.source_id=$1 ORDER BY c.updated_at DESC,c.id LIMIT 101`,
        [id],
      );
      return json({
        source,
        related: related.slice(0, 100),
        has_more: related.length > 100,
      });
    }
    // Aggregate across the database, not just the first 100 UI records.
    const [counts] = await db.query(`SELECT
      (SELECT count(*)::int FROM agents) AS agents,
      (SELECT count(*)::int FROM agents WHERE active) AS authorized,
      (SELECT count(*)::int FROM projects) AS projects,
      (SELECT count(*)::int FROM contents) AS contents,
      (SELECT count(*)::int FROM sources) AS sources,
      (SELECT count(*)::int FROM sources WHERE original_url IS NOT NULL AND original_url<>'') AS url_sources,
      (SELECT count(DISTINCT cs.source_id)::int FROM content_sources cs JOIN contents c ON c.id=cs.content_id AND c.current_version=cs.version) AS linked_sources,
      (SELECT count(*)::int FROM sources WHERE fetched_at>=now()-interval '7 days') AS recent_sources,
      (SELECT count(*)::int FROM assets) AS assets,
      (SELECT count(*)::int FROM artifacts) AS artifacts,
      (SELECT count(*)::int FROM publications) AS publications,
      (SELECT count(*)::int FROM agent_requests) AS requests,
      (SELECT count(*)::int FROM agent_requests WHERE created_at>=now()-interval '7 days' AND status>=400) AS errors_7d`);
    const [projects, days] = await Promise.all([
      db.query(`SELECT p.id,p.name,
        (SELECT count(*)::int FROM contents c WHERE c.project_id=p.id) AS contents,
        (SELECT count(*)::int FROM sources s WHERE s.project_id=p.id) AS sources,
        (SELECT count(*)::int FROM agents a WHERE p.id=ANY(a.project_ids)) AS agents
        FROM projects p ORDER BY p.created_at,p.id`),
      db.query(`SELECT to_char(d.day,'YYYY-MM-DD') AS day,
        (SELECT count(*)::int FROM agent_requests r WHERE r.created_at>=(d.day AT TIME ZONE 'UTC') AND r.created_at<((d.day+interval '1 day') AT TIME ZONE 'UTC')) AS requests,
        (SELECT count(*)::int FROM agent_requests r WHERE r.created_at>=(d.day AT TIME ZONE 'UTC') AND r.created_at<((d.day+interval '1 day') AT TIME ZONE 'UTC') AND r.status>=400) AS errors
        FROM generate_series(date_trunc('day',now() AT TIME ZONE 'UTC')-interval '6 days',date_trunc('day',now() AT TIME ZONE 'UTC'),interval '1 day') AS d(day)
        ORDER BY d.day`),
    ]);
    return json({
      counts,
      projects,
      days,
      observed_at: new Date().toISOString(),
      timezone: "UTC",
      coverage:
        "仅统计已记录的 Agent JSON/MCP 业务调用，不含上传、下载和管理操作。",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
