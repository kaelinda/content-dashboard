import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { dataDirectory } from "./db.ts";
import { HubError } from "./domain.ts";
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
function key(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new HubError("文件摘要无效");
  return `blobs/sha256/${hash.slice(0, 2)}/${hash}`;
}
async function s3() {
  const sdk = await import("@aws-sdk/client-s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new HubError("S3 存储未完整配置", 503);
  const client = new sdk.S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            ...(process.env.S3_SESSION_TOKEN
              ? { sessionToken: process.env.S3_SESSION_TOKEN }
              : {}),
          }
        : undefined,
  });
  return { sdk, client, bucket };
}
export async function putBlob(bytes: Uint8Array): Promise<string> {
  const hash = sha256(bytes);
  const blobKey = key(hash);
  if (process.env.STORAGE_DRIVER === "s3") {
    const { sdk, client, bucket } = await s3();
    try {
      await client.send(
        new sdk.PutObjectCommand({
          Bucket: bucket,
          Key: blobKey,
          Body: bytes,
          ContentType: "application/octet-stream",
          IfNoneMatch: "*",
          Metadata: { sha256: hash },
        }),
      );
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status !== 412) throw e;
      const existing = await getBlob(hash);
      if (sha256(existing) !== hash) throw new Error("Blob integrity mismatch");
    } finally {
      client.destroy();
    }
  } else {
    const path = join(dataDirectory(), blobKey);
    await mkdir(join(dataDirectory(), "blobs/sha256", hash.slice(0, 2)), {
      recursive: true,
      mode: 0o700,
    });
    const temporary = path + "." + randomUUID() + ".tmp";
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      // An atomic hard link publishes only a complete, flushed file and never replaces an existing blob.
      try {
        await link(temporary, path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        if (sha256(await readFile(path)) !== hash)
          throw new Error("Blob integrity mismatch");
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  return hash;
}
export async function getBlob(hash: string): Promise<Buffer> {
  const blobKey = key(hash);
  let bytes: Buffer;
  if (process.env.STORAGE_DRIVER === "s3") {
    const { sdk, client, bucket } = await s3();
    try {
      const result = await client.send(
        new sdk.GetObjectCommand({ Bucket: bucket, Key: blobKey }),
      );
      if (!result.Body) throw new HubError("文件不存在", 404);
      bytes = Buffer.from(await result.Body.transformToByteArray());
    } finally {
      client.destroy();
    }
  } else bytes = await readFile(join(dataDirectory(), blobKey));
  if (sha256(bytes) !== hash)
    throw new HubError("文件完整性校验失败，请从备份恢复", 500);
  return bytes;
}

// Shared only by server-side read-only diagnostics.
export { s3 as storageConnection, key as blobKey };
