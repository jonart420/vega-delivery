import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage for proof-of-delivery photos and signatures from the apps.
 * UPLOAD_DIR: /data/uploads in the container, <repo>/data/uploads for `npm run dev`
 * (deliberately outside backend/, otherwise every written file triggers a dev rebuild).
 */

export const MAX_PROOF_BYTES = 15 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
};
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));

export function uploadDir(): string {
  return path.resolve(process.cwd(), process.env.UPLOAD_DIR || "../data/uploads");
}

/** Absolute path for a stored relative path – never outside UPLOAD_DIR. */
export function resolveUpload(rel: string): string | null {
  const base = uploadDir();
  const abs = path.resolve(base, rel);
  return abs.startsWith(base + path.sep) ? abs : null;
}

export const mimeForPath = (p: string) => EXT_MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Stores an uploaded image (from FormData) and returns its relative path, or throws. */
export async function storeProofFile(file: File, kind: "photo" | "signature"): Promise<string> {
  const ext = MIME_EXT[file.type.toLowerCase()];
  if (!ext) throw new Error(`unsupported file type ${file.type || "?"}`);
  if (file.size > MAX_PROOF_BYTES) throw new Error("file too large (max. 15 MB)");
  const now = new Date();
  const rel = path.join(
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${kind}-${randomUUID()}.${ext}`,
  );
  const abs = resolveUpload(rel)!;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, Buffer.from(await file.arrayBuffer()));
  return rel;
}
