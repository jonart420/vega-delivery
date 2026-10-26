import { readFile } from "node:fs/promises";
import path from "node:path";
import { BRANDING_FILES, brandingDir } from "@/lib/branding";

const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
};

/** Serves logo/favicon files from the mounted branding folder (whitelist only). */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!(BRANDING_FILES as readonly string[]).includes(file)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(path.join(brandingDir(), file));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": MIME[file.split(".").pop() ?? ""] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=300",
        // SVGs from the branding folder must not run scripts
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
