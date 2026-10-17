import { database } from "./db.ts";
import { digestToken } from "./crypto.ts";
import { HubError } from "./domain.ts";
export class RateLimitError extends HubError {
    readonly retryAfterSeconds: number;
    constructor(seconds: number) {
        super("请求过于频繁，请按 Retry-After 等待后重试", 429);
        this.retryAfterSeconds = Math.max(1, Math.ceil(seconds));
    }
}
export function retryAfter(error: unknown): number | undefined {
    return error instanceof RateLimitError ? error.retryAfterSeconds : undefined;
}
/** Use the database clock, shared by all instances, for both windows and waits. */
export async function rateLimit(key: string, max: number, seconds: number) {
    if (!Number.isSafeInteger(max) || max < 1 ||
        !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400)
        throw new Error("Invalid rate limit configuration");
    const db = await database();
    const [row] = await db.query<{
        attempts: number;
        retry_after: number;
    }>(`WITH stamp AS (SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms)
     INSERT INTO rate_limits(key,window_start,attempts)
     SELECT $1,(ms/($2::bigint*1000))*($2::bigint*1000),1 FROM stamp
     ON CONFLICT(key,window_start) DO UPDATE SET attempts=rate_limits.attempts+1
     RETURNING attempts,greatest(1,ceil((window_start+$2::bigint*1000-
       extract(epoch FROM clock_timestamp())*1000)/1000))::int AS retry_after`, [digestToken(key), seconds]);
    if (row.attempts > max)
        throw new RateLimitError(row.retry_after);
    await db.query("DELETE FROM rate_limits WHERE window_start<extract(epoch FROM now())*1000-86400000");
}
