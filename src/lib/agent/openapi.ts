import { outputSchema } from "./outputs.ts";
import { z } from "zod";
import { contracts, type Operation } from "./contracts.ts";
export function openApiDocument() {
  const paths: Record<string, unknown> = {};
  for (const [operationId, c] of Object.entries(contracts)) {
    const input = z.toJSONSchema(c.schema) as {
      properties: Record<string, unknown>;
      required?: string[];
      [k: string]: unknown;
    };
    const properties = { ...input.properties };
    const required = [...(input.required ?? [])];
    const parameters: unknown[] = [];
    if (c.path.includes("{id}")) {
      parameters.push({
        name: "id",
        in: "path",
        required: true,
        schema: properties.id,
      });
      delete properties.id;
    }
    if (c.method === "GET")
      for (const [name, schema] of Object.entries(properties))
        parameters.push({
          name,
          in: "query",
          required: required.includes(name),
          schema,
        });
    else {
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: properties.idempotency_key,
        description: "与 MCP 的 idempotency_key 相同，重试必须复用。",
      });
      delete properties.idempotency_key;
    }
    const responses: Record<string, unknown> = {};
    responses[c.method === "POST" ? "201" : "200"] = {
      description: "Committed receipt or bounded read result",
      content: {
        "application/json": {
          schema: z.toJSONSchema(outputSchema(operationId as Operation)),
        },
      },
    };
    for (const code of [400, 401, 403, 404, 409, 413, 415, 422, 429, 500])
      responses[String(code)] = {
        description: "RFC 9457 problem details",
        content: {
          "application/problem+json": {
            schema: { $ref: "#/components/schemas/Problem" },
          },
        },
      };
    paths["/api/v1" + c.path] = {
      [c.method.toLowerCase()]: {
        operationId,
        summary: c.description,
        security: [{ bearerAuth: [] }],
        parameters,
        ...(c.method !== "GET"
          ? {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties,
                      required: required.filter((k) => k in properties),
                      additionalProperties: false,
                      ...(operationId === "content_create"
                        ? {
                            oneOf: [
                              {
                                required: ["markdown"],
                                not: { required: ["blocks"] },
                              },
                              {
                                required: ["blocks"],
                                not: { required: ["markdown"] },
                              },
                            ],
                          }
                        : {}),
                    },
                  },
                },
              },
            }
          : {}),
        responses,
        "x-required-scope": c.scope,
      },
    };
  }
  paths["/api/v1/files"] = {
    post: {
      operationId: "file_upload",
      description:
        "上传原始字节，最大 20 MiB。文件名必须是 basename；签名/UTF-8 校验不是恶意软件扫描。",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "project_id",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "X-Filename",
          in: "header",
          required: true,
          schema: { type: "string" },
          description: "百分号编码的文件名",
        },
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string", minLength: 8, maxLength: 128 },
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
            "video/webm",
          ].map((mime) => [
            mime,
            { schema: { type: "string", format: "binary" } },
          ]),
        ),
      },
      responses: {
        "201": {
          description:
            "File ID, server-calculated sha256 and committed receipt",
        },
        "415": { description: "Unsupported MIME or mismatched bytes" },
      },
    },
  };
  for (const kind of ["files", "artifacts"])
    paths[`/api/v1/${kind}/{id}/download`] = {
      get: {
        operationId: kind + "_download",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Private attachment. Do not execute untrusted HTML.",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "404": { description: "Not found or outside project grant" },
        },
      },
    };
  return {
    openapi: "3.1.1",
    info: {
      title: "Content Hub Agent API",
      version: "1.1.0",
      description:
        "多 Agent 权威数据中枢。先查询 capabilities；网页管理操作与 Agent API 分离。OAuth/MCP 按显式授权开放；不包含外部自动发布。",
    },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: {
        Problem: {
          type: "object",
          required: [
            "type",
            "title",
            "status",
            "code",
            "detail",
            "request_id",
            "retryable",
          ],
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            code: { type: "string" },
            detail: { type: "string" },
            request_id: { type: "string" },
            retryable: { type: "boolean" },
            errors: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  };
}
