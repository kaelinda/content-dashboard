import { z } from "zod";
import { operations, uploadOperation } from "./contracts.ts";
import { problemSchema } from "./errors.ts";
function schema(value: z.ZodType, io: "input" | "output" = "input"): any {
  const { $schema, ...s } = z.toJSONSchema(value, {
    io,
    unrepresentable: "any",
  });
  return s;
}
export function openapi() {
  const paths: Record<string, any> = {};
  for (const op of operations) {
    const input = schema(op.input),
      parameters: any[] = [],
      bodyProperties = { ...input.properties };
    const required: string[] = input.required ?? [];
    for (const [name, property] of Object.entries(
      input.properties as Record<string, unknown>,
    )) {
      if (name === "idempotency_key") {
        parameters.push({
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: property,
        });
        delete bodyProperties[name];
      } else if (name === "id" && op.path.includes("{id}")) {
        parameters.push({ name, in: "path", required: true, schema: property });
        delete bodyProperties[name];
      } else if (!op.write) {
        parameters.push({
          name,
          in: "query",
          required: required.includes(name),
          schema: property,
        });
        delete bodyProperties[name];
      }
    }
    const bodySchema = {
      ...input,
      properties: bodyProperties,
      required: required.filter((k) => k in bodyProperties),
      ...(op.name === "content_create"
        ? {
            oneOf: [
              { required: ["markdown"], not: { required: ["blocks"] } },
              { required: ["blocks"], not: { required: ["markdown"] } },
            ],
          }
        : {}),
    };
    const errors = Object.fromEntries(
      [400, 401, 403, 404, 409, 413, 422, 428, 429, 500, 503].map((code) => [
        code,
        {
          description:
            "Structured problem details. Check code, retryable, recovery and request_id.",
          content: {
            "application/problem+json": {
              schema: { $ref: "#/components/schemas/Problem" },
            },
          },
        },
      ]),
    );
    (paths["/api/v1" + op.path] ??= {})[op.method.toLowerCase()] = {
      operationId: op.name,
      description: op.description,
      security: [{ AgentBearer: [] }],
      parameters,
      "x-required-scopes": op.scopes,
      "x-scope-mode": op.anyScope ? "any" : "all",
      ...(op.write
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: bodySchema } },
            },
          }
        : {}),
      responses: {
        [op.method === "POST" ? 201 : 200]: {
          description:
            "Validated operation result; write receipts report durable commit and replay state.",
          content: {
            "application/json": { schema: schema(op.output, "output") },
          },
        },
        ...errors,
      },
    };
  }
  const failure = {
    description: "Structured error",
    content: {
      "application/problem+json": {
        schema: { $ref: "#/components/schemas/Problem" },
      },
    },
  };
  paths["/api/v1/files"] = {
    post: {
      operationId: "file_upload",
      description: uploadOperation.description,
      security: [{ AgentBearer: [] }],
      parameters: [
        {
          name: "project_id",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", minLength: 8, maxLength: 128 },
        },
        {
          name: "X-Filename",
          in: "header",
          required: true,
          description: "URI-encoded filename, not a filesystem path.",
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: Object.fromEntries(
          [
            "text/html",
            "text/markdown",
            "text/plain",
            "application/json",
            "application/pdf",
            "image/png",
            "image/jpeg",
            "image/webp",
            "video/mp4",
            "audio/mpeg",
            "application/octet-stream",
          ].map((mime) => [
            mime,
            { schema: { type: "string", format: "binary" } },
          ]),
        ),
      },
      responses: {
        201: {
          description:
            "Stored file metadata. Max 10 MiB. Raster uploads also create a sanitized asset.",
          content: {
            "application/json": {
              schema: schema(uploadOperation.output, "output"),
            },
          },
        },
        default: failure,
      },
    },
  };
  for (const resource of ["files", "artifacts"]) {
    paths["/api/v1/" + resource + "/{id}/download"] = {
      get: {
        operationId: (resource === "files" ? "file" : "artifact") + "_download",
        description:
          "Download immutable original bytes as a private sandboxed attachment; never execute untrusted HTML.",
        security: [{ AgentBearer: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "project_id",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Original bytes",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          default: failure,
        },
      },
    };
  }
  return {
    openapi: "3.1.1",
    info: {
      title: "Content Hub Agent Gateway",
      version: "1.1.0",
      description:
        "Project-scoped Agent data API. REST and MCP share authorization, validation, idempotency, versions and receipts. Owner-only administration and legacy compatibility routes are separate surfaces. No automatic publishing or background jobs.",
    },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: {
        AgentBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Create a scoped Agent credential in the authenticated Agent console. Keep the secret in the executor, not in content.",
        },
      },
      schemas: { Problem: schema(problemSchema) },
    },
  };
}
