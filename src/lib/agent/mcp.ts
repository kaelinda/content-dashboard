import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Actor } from "../auth.ts";
import { readBytes } from "../http.ts";
import { operations } from "./contracts.ts";
import { allowedOperations, execute } from "./service.ts";
import { problem } from "./errors.ts";
export async function scopedMcp(
  request: Request,
  actor: Actor,
): Promise<Response> {
  const server = new McpServer({
    name: "content-hub-agent-gateway",
    version: "1.1.0",
  });
  const allowed = new Set(allowedOperations(actor).map((o) => o.name));
  for (const op of operations.filter((o) => allowed.has(o.name))) {
    server.registerTool(
      op.name,
      {
        title: op.name,
        description: op.description,
        inputSchema: op.input,
        outputSchema: op.output,
        annotations: {
          readOnlyHint: !op.write,
          destructiveHint: op.name === "content_update_blocks",
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => {
        const requestId = randomUUID();
        try {
          const value = await execute(actor, op.name, args, requestId);
          return {
            structuredContent: value,
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
          };
        } catch (e) {
          const value = problem(e, requestId);
          return {
            isError: true,
            structuredContent: value,
            content: [{ type: "text" as const, text: JSON.stringify(value) }],
          };
        }
      },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: new Uint8Array(await readBytes(request)),
      }),
    );
  } finally {
    await server.close();
  }
}
