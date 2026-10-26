import { NextResponse } from "next/server";
import { badId, isUuid, notFound } from "@/lib/api";
import { revokeDevices } from "@/lib/app-auth";
import { apiAdmin } from "@/lib/auth";
import { generateLoginCode, LoginCodeConfigError, revokeLoginCode } from "@/lib/login-code";

type Ctx = { params: Promise<{ id: string }> };

/** New login code (QR) and sign out previous devices – admins only. */
export async function POST(_req: Request, { params }: Ctx) {
  const admin = await apiAdmin();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  try {
    const member = await generateLoginCode(id);
    if (!member) return notFound();
    await revokeDevices(id);
    return NextResponse.json({ member });
  } catch (e) {
    if (e instanceof LoginCodeConfigError) return NextResponse.json({ error: e.message }, { status: 500 });
    throw e;
  }
}

/** Revoke login code (delete hash) and sign out devices – admins only. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const admin = await apiAdmin();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const member = await revokeLoginCode(id);
  if (!member) return notFound();
  await revokeDevices(id);
  return NextResponse.json({ member });
}
