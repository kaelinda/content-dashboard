import { access, lstat, open, opendir } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { dataDirectory } from "./db.ts";
import { blobKey, storageConnection } from "./storage.ts";
const validHash = /^[a-f0-9]{64}$/;
/** This module intentionally imports no PutObject/DeleteObject and does not create files. */
export async function blobMetadata(hash: string) {
    if (process.env.STORAGE_DRIVER === "s3") {
        const { sdk, client, bucket } = await storageConnection();
        try {
            const result = await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: blobKey(hash) }), { abortSignal: AbortSignal.timeout(5000) });
            return { bytes: result.ContentLength ?? null, modified_at: result.LastModified?.toISOString() ?? null };
        }
        finally {
            client.destroy();
        }
    }
    const stat = await lstat(join(dataDirectory(), blobKey(hash)));
    if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Not a regular blob");
    return { bytes: stat.size, modified_at: stat.mtime.toISOString() };
}
export async function verifyBlobBytes(hash: string): Promise<boolean> {
    const digest = createHash("sha256");
    const maxBytes = 64 * 1024 * 1024;
    let bytes = 0;
    if (process.env.STORAGE_DRIVER === "s3") {
        const { sdk, client, bucket } = await storageConnection();
        try {
            const object = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: blobKey(hash) }), { abortSignal: AbortSignal.timeout(10000) });
            if (!object.Body || (object.ContentLength ?? 0) > maxBytes)
                throw new Error("Blob verification limit");
            const stream = object.Body as AsyncIterable<Uint8Array> & {
                destroy?: () => void;
            };
            try {
                for await (const chunk of stream) {
                    bytes += chunk.length;
                    if (bytes > maxBytes)
                        throw new Error("Blob verification limit");
                    digest.update(chunk);
                }
            }
            finally {
                stream.destroy?.();
            }
        }
        finally {
            client.destroy();
        }
    }
    else {
        const file = await open(join(dataDirectory(), blobKey(hash)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.size > maxBytes)
                throw new Error("Blob verification limit");
            const buffer = Buffer.alloc(64 * 1024);
            for (;;) {
                const read = await file.read(buffer, 0, buffer.length, null);
                if (!read.bytesRead)
                    break;
                bytes += read.bytesRead;
                if (bytes > maxBytes)
                    throw new Error("Blob verification limit");
                digest.update(buffer.subarray(0, read.bytesRead));
            }
        }
        finally {
            await file.close();
        }
    }
    return digest.digest("hex") === hash;
}
export function isMissingBlob(error: unknown) {
    const e = error as {
        code?: string;
        name?: string;
        $metadata?: {
            httpStatusCode?: number;
        };
    };
    return e?.code === "ENOENT" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}
export async function inspectLocalDirectory() {
    await access(dataDirectory(), constants.R_OK | constants.W_OK);
    return { code: "DIRECTORY_ACCESS_CHECKED", write_checked: false };
}
export type BlobEntry = {
    sha256: string;
    modified_at: string | null;
};
export async function listStoredBlobs(limit: number) {
    const entries: BlobEntry[] = [];
    let ignored = 0, complete = true;
    if (process.env.STORAGE_DRIVER === "s3") {
        const { sdk, client, bucket } = await storageConnection();
        let cursor: string | undefined;
        const cursors = new Set<string>();
        const deadline = Date.now() + 60000;
        try {
            do {
                const page = await client.send(new sdk.ListObjectsV2Command({ Bucket: bucket, Prefix: "blobs/sha256/", MaxKeys: Math.min(1000, limit + 1 - entries.length), ContinuationToken: cursor }), { abortSignal: AbortSignal.timeout(5000) });
                for (const item of page.Contents ?? []) {
                    const match = item.Key?.match(/^blobs\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})$/);
                    if (!match || match[1] !== match[2].slice(0, 2)) {
                        ignored++;
                        continue;
                    }
                    entries.push({ sha256: match[2], modified_at: item.LastModified?.toISOString() ?? null });
                }
                cursor = page.IsTruncated ? page.NextContinuationToken : undefined;
                if (page.IsTruncated && !cursor) {
                    complete = false;
                    break;
                }
                if (entries.length > limit || ignored > limit) {
                    complete = false;
                    break;
                }
                        if (cursor && (cursors.has(cursor) || Date.now() > deadline)) { complete = false; break; }
            if (cursor) cursors.add(cursor);
            } while (cursor);
        }
        finally {
            client.destroy();
        }
    }
    else {
        const root = join(dataDirectory(), "blobs/sha256");
        try {
            outer: for await (const folder of await opendir(root)) {
                if (ignored > limit) {
                    complete = false;
                    break;
                }
                if (!folder.isDirectory() || !/^[a-f0-9]{2}$/.test(folder.name)) {
                    ignored++;
                    continue;
                }
                for await (const file of await opendir(join(root, folder.name))) {
                    if (ignored > limit) {
                        complete = false;
                        break outer;
                    }
                    if (!file.isFile() || !validHash.test(file.name) || !file.name.startsWith(folder.name)) {
                        ignored++;
                        continue;
                    }
                    const stat = await lstat(join(root, folder.name, file.name));
                    if (!stat.isFile() || stat.isSymbolicLink()) {
                        ignored++;
                        continue;
                    }
                    entries.push({ sha256: file.name, modified_at: stat.mtime.toISOString() });
                    if (entries.length > limit || ignored > limit) {
                        complete = false;
                        break outer;
                    }
                }
            }
        }
        catch (error) {
            if (!isMissingBlob(error))
                throw error;
        }
    }
    return { entries: entries.slice(0, limit), complete, ignored };
}
