import { NextResponse } from "next/server";
import sharp from "sharp";
import { badId, fail, isUuid, notFound } from "@/lib/api";
import { apiUser } from "@/lib/auth";
import { canSeeCode, getTeamMember, renderLoginCodePng } from "@/lib/login-code";

/** Login code as PNG (1024×1024). ?size=64…1024 returns an inline preview, without size a download. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  if (!canSeeCode(user, id)) return fail("admin_only", 403);
  const member = await getTeamMember(id);
  if (!member) return notFound();
  const c = member.code;
  if (c.status !== "valid") return fail(c.status === "revoked" ? "code_revoked" : "code_missing", 409);

  let png = await renderLoginCodePng({ code: c.code, username: member.display_name || member.username });
  const sizeParam = new URL(req.url).searchParams.get("size");
  const headers: Record<string, string> = { "Content-Type": "image/png", "Cache-Control": "no-store" };
  if (sizeParam) {
    const size = Math.min(1024, Math.max(64, Number.parseInt(sizeParam, 10) || 256));
    if (size !== 1024) png = await sharp(png).resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
    headers["Content-Disposition"] = "inline";
  } else {
    const safe = member.username.replace(/[^a-zA-Z0-9._-]/g, "_");
    headers["Content-Disposition"] = `attachment; filename="login-code-${safe}.png"`;
  }
  return new NextResponse(new Uint8Array(png), { headers });
}
