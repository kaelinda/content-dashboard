/** Small executor-side REST client. Secrets stay in the executor, never in content. */
export class HubClient {
  /** @param {{baseUrl:string,token:string,fetchImpl?:typeof fetch,maxAttempts?:number}} options */
  constructor({ baseUrl, token, fetchImpl = fetch, maxAttempts = 3 }) {
    const u = new URL(baseUrl);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
      throw new Error("baseUrl must be the Hub origin only.");
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
      )
    )
      throw new Error("Remote Hub connections require HTTPS.");
    if (!token) throw new Error("An executor-side Agent token is required.");
    this.baseUrl = u.origin;
    this.token = token;
    this.fetch = fetchImpl;
    this.maxAttempts = Math.max(1, Math.min(5, maxAttempts));
  }
  /** @param {string} path @param {{method?:string,body?:unknown,idempotencyKey?:string}} options */
  async request(path, { method = "GET", body, idempotencyKey } = {}) {
    if (
      !path.startsWith("/") ||
      path.startsWith("//") ||
      path.includes("\\") ||
      path.includes("#")
    )
      throw new Error("Use a relative Agent API path.");
    if (method !== "GET" && !idempotencyKey)
      throw new Error(
        "Pass a persistent idempotencyKey for every logical write, and reuse it on retries.",
      );
    let last;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let response;
      try {
        response = await this.fetch(this.baseUrl + "/api/v1" + path, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: "Bearer " + this.token,
            Accept: "application/json, application/problem+json",
            ...(body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      } catch (e) {
        last = e;
        if (attempt + 1 === this.maxAttempts) throw e;
        await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        continue;
      }
      const data = await response.json();
      if (response.ok) return data;
      const failure = new Error(
        data.detail || data.error || "Hub request failed",
      );
      failure.code = data.code;
      failure.problem = data;
      if (
        ![429, 500, 502, 503, 504].includes(response.status) ||
        attempt + 1 === this.maxAttempts
      )
        throw failure;
      last = failure;
      const retry = response.headers.get("Retry-After");
      const delay =
        retry && /^\d+$/.test(retry)
          ? Math.min(Number(retry) * 1000, 60000)
          : 200 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
    throw last;
  }
}
