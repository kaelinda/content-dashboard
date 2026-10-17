import { setTimeout as wait } from "node:timers/promises";

export class HubRequestError extends Error {
  constructor(
    message,
    {
      status = 0,
      code = "NETWORK_ERROR",
      problem = null,
      outcomeUnknown = false,
      retryAfterMs = null,
    } = {},
  ) {
    super(message);
    this.name = "HubRequestError";
    this.status = status;
    this.code = code;
    this.problem = problem;
    this.outcomeUnknown = outcomeUnknown;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Executor-side JSON REST helper. Store credentials in the executor, not model prompts. */
export class HubClient {
  #token;
  constructor({
    baseUrl,
    token,
    fetchImpl = fetch,
    maxAttempts = 3,
    timeoutMs = 20000,
    maxRetryDelayMs = 60000,
    sleep = (ms, signal) => wait(ms, undefined, { signal }),
  }) {
    const url = new URL(baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("baseUrl must be the Hub origin only.");
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("Remote Hub connections require HTTPS.");
    if (typeof token !== "string" || !token || /[\r\n]/.test(token))
      throw new Error("An executor-side Agent token is required.");
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5)
      throw new Error("maxAttempts must be an integer from 1 to 5.");
    for (const [name, value] of Object.entries({ timeoutMs, maxRetryDelayMs }))
      if (!Number.isInteger(value) || value < 1 || value > 300000)
        throw new Error(name + " must be 1–300000 ms.");
    this.baseUrl = url.origin;
    this.#token = token;
    this.fetch = fetchImpl;
    this.maxAttempts = maxAttempts;
    this.timeoutMs = timeoutMs;
    this.maxRetryDelayMs = maxRetryDelayMs;
    this.sleep = sleep;
  }

  /** Paths are relative to /api/v1. Persist one idempotency key per logical write. */
  async request(path, { method = "GET", body, idempotencyKey, signal } = {}) {
    method = method.toUpperCase();
    if (!["GET", "POST", "PATCH"].includes(method))
      throw new Error("Use GET, POST or PATCH for the Agent JSON API.");
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      /[\\#\r\n]/.test(path)
    )
      throw new Error("Use a relative Agent API path.");
    const url = new URL("/api/v1" + path, this.baseUrl);
    if (url.origin !== this.baseUrl || !url.pathname.startsWith("/api/v1/"))
      throw new Error("Path must stay within /api/v1/.");
    const write = method !== "GET";
    if (write && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey ?? ""))
      throw new Error(
        "Pass a persistent idempotencyKey and reuse it for all retries.",
      );
    if (!write && body !== undefined)
      throw new Error("GET requests cannot include a body.");
    if (
      body &&
      typeof body === "object" &&
      "idempotency_key" in body &&
      body.idempotency_key !== idempotencyKey
    )
      throw new Error("Header and body idempotency keys must agree.");
    // Serialize ONCE: mutating the caller's object during a retry cannot alter this request.
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let last;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (signal?.aborted)
        throw new HubRequestError("Request cancelled.", {
          code: "ABORTED",
          outcomeUnknown: write && attempt > 0,
        });
      let response, data;
      try {
        const deadline = AbortSignal.timeout(this.timeoutMs);
        response = await this.fetch(url.href, {
          method,
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
          headers: {
            Authorization: "Bearer " + this.#token,
            Accept: "application/json, application/problem+json",
            ...(payload === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          ...(payload === undefined ? {} : { body: payload }),
        });
        try {
          data = await response.json();
        } catch {
          data = null;
        }
      } catch {
        if (signal?.aborted)
          throw new HubRequestError(
            "Request cancelled; a sent write may already have committed.",
            { code: "ABORTED", outcomeUnknown: write },
          );
      }
      const valid =
        data !== null && typeof data === "object" && !Array.isArray(data);
      if (response?.ok && valid) return data;
      const status = response?.status ?? 0;
      const transient =
        !response ||
        (response.ok && !valid) ||
        [429, 500, 502, 503, 504].includes(status);
      const header = response?.headers.get("Retry-After");
      const date = header ? Date.parse(header) : NaN;
      const retryAfterMs =
        header && /^\d+$/.test(header.trim())
          ? Number(header.trim()) * 1000
          : Number.isFinite(date)
            ? Math.max(0, date - Date.now())
            : null;
      last = new HubRequestError(
        valid
          ? data.detail || data.error || "Hub request failed."
          : "Hub response was unavailable or not valid JSON.",
        {
          status,
          code:
            valid && typeof data.code === "string"
              ? data.code
              : response
                ? "INVALID_RESPONSE"
                : "NETWORK_ERROR",
          problem: valid ? data : null,
          outcomeUnknown:
            write && (status === 0 || status >= 500 || !!response?.ok),
          retryAfterMs,
        },
      );
      if (
        !transient ||
        (valid && data.retryable === false) ||
        attempt + 1 === this.maxAttempts
      )
        throw last;
      const delay =
        retryAfterMs ?? Math.min(200 * 2 ** attempt, this.maxRetryDelayMs);
      // Never retry earlier than the server requested. Return control if waiting exceeds this client's budget.
      if (delay > this.maxRetryDelayMs) throw last;
      try {
        await this.sleep(delay, signal);
      } catch {
        throw new HubRequestError("Request cancelled while waiting to retry.", {
          code: "ABORTED",
          outcomeUnknown: last.outcomeUnknown,
        });
      }
    }
    throw last;
  }
}
