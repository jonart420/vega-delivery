import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { badId, isUuid, notFound } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { mimeForPath, resolveUpload } from "@/lib/uploads";

/** Proof-of-delivery files: /api/events/<id>/photo or /signature */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id, file } = await params;
  if (!isUuid(id) || (file !== "photo" && file !== "signature")) return badId();
  const row = await q1<{ p: string | null }>(`select ${file === "photo" ? "photo_path" : "signature_path"} as p from delivery_events where id = $1`, [id]);
  const abs = row?.p ? resolveUpload(row.p) : null;
  if (!abs) return notFound();
  try {
    const data = await readFile(abs);
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": mimeForPath(abs), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return notFound();
  }
}
