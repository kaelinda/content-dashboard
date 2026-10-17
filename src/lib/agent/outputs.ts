import { z } from "zod";
import { type Operation } from "./contracts.ts";
const id = z.string();
const loose = (shape: z.ZodRawShape) => z.object(shape).passthrough();
const range = loose({
  unit: z.enum(["unicode_code_points", "blocks"]),
  offset: z.number(),
  limit: z.number(),
  total: z.number(),
  next_offset: z.number().nullable(),
  truncated: z.boolean(),
});
const receipt = loose({
  id,
  content_id: id,
  version: z.number(),
  status: z.string(),
  block_ids: z.array(id),
});
const common = {
  id,
  title: z.string(),
  project_id: id,
  version: z.number(),
  current_version: z.number(),
  status: z.string(),
  trust: z.string(),
};
const content = z.discriminatedUnion("view", [
  loose({
    ...common,
    view: z.literal("summary"),
    excerpt: z.string(),
    block_count: z.number(),
    source_count: z.number(),
  }),
  loose({ ...common, view: z.literal("markdown"), text: z.string(), range }),
  loose({
    ...common,
    view: z.literal("blocks"),
    source_ids: z.array(id),
    blocks: z.array(
      loose({
        id,
        type: z.string(),
        text: z.string(),
        source_refs: z.array(id),
      }),
    ),
    range,
  }),
]);
const dataSchemas: Record<Operation, z.ZodType> = {
  hub_capabilities: loose({
    api_version: z.string(),
    principal: loose({ id, name: z.string(), legacy_token: z.boolean() }),
    projects: z.array(loose({ id, name: z.string() })),
    scopes: z.array(z.string()),
    operations: z.array(z.string()),
    limits: z.record(z.string(), z.number()),
    supported: z.record(z.string(), z.boolean()),
  }),
  hub_search: loose({
    items: z.array(
      loose({
        key: z.string(),
        kind: z.enum(["content", "source", "artifact"]),
        id,
        title: z.string(),
        excerpt: z.string(),
        version: z.number().nullable(),
      }),
    ),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
    trust: z.string(),
  }),
  source_save: loose({
    id,
    source_id: id,
    snapshot_sha256: z.string(),
    trust: z.string(),
    project_id: id,
  }),
  source_get: z.discriminatedUnion("view", [
    loose({
      id,
      title: z.string(),
      project_id: id,
      snapshot_sha256: z.string(),
      view: z.literal("summary"),
      excerpt: z.string(),
    }),
    loose({
      id,
      title: z.string(),
      project_id: id,
      snapshot_sha256: z.string(),
      view: z.literal("markdown"),
      text: z.string(),
      range,
    }),
  ]),
  content_create: receipt,
  content_get: content,
  content_update_blocks: receipt,
  artifact_register: loose({
    id,
    artifact_id: id,
    content_id: id,
    content_version: z.number(),
    sha256: z.string(),
    bytes: z.number(),
    mime: z.string(),
    immutable: z.boolean(),
    deduplicated: z.boolean(),
  }),
  artifact_get: loose({
    id,
    content_id: id,
    content_version: z.number(),
    title: z.string(),
    kind: z.string(),
    variant: z.string(),
    sha256: z.string(),
    bytes: z.number(),
    mime: z.string(),
    recipe: z.record(z.string(), z.unknown()),
    project_id: id,
    current_version: z.number(),
    stale: z.boolean(),
    download_path: z.string(),
    trust: z.string(),
  }),
  hub_changes: loose({
    items: z.array(
      loose({
        id,
        kind: z.string(),
        resource_id: id,
        version: z.number().nullable(),
        operation: z.string(),
        actor: z.string(),
        created_at: z.string(),
      }),
    ),
    has_more: z.boolean(),
    next_cursor: z.string(),
    high_watermark: z.string(),
    delivery: z.string(),
  }),
};
export function outputSchema(op: Operation) {
  return z
    .object({
      data: dataSchemas[op],
      meta: z
        .object({
          request_id: z.string(),
          replayed: z.boolean(),
          committed: z.boolean(),
        })
        .strict(),
    })
    .strict();
}
