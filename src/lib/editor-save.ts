import { saveContent } from "./repository.ts";
import { database } from "./db.ts";
import { resolvePrincipal } from "./agent/principal.ts";
import { idempotent, resource } from "./agent/service.ts";
import { HubError } from "./domain.ts";

/** Optional idempotency for the existing UI contract; old clients stay compatible. */
export async function saveEditorContent(
  request: Request,
  input: unknown,
  actor: string,
  id?: string,
) {
  const key = request.headers.get("idempotency-key");
  if (!key) return saveContent(input, id, actor);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
    throw new HubError("幂等键格式无效", 422);
  const p = await resolvePrincipal(request);
  const db = await database();
  if (id) await resource(db, p, "content", id);
  const receipt = await idempotent(
    db,
    p,
    key,
    "editor_save",
    { id, input },
    (tx) => saveContent(input, id, actor, { db: tx }),
  );
  return receipt.data;
}
