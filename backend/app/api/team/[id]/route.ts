import { NextResponse } from "next/server";
import { z } from "zod";
import { badId, fail, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { revokeDevices } from "@/lib/app-auth";
import { apiAdmin } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { getTeamMember } from "@/lib/login-code";
import { hashPassword } from "@/lib/password";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.object({
  display_name: z.string().trim().max(80).nullable().optional(),
  role: z.enum(["driver", "dispatcher", "admin"]).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().optional(),
  password: z.string().min(12).max(200).nullable().optional(),
});

/** Updates a team member (admins only). Deactivating signs out all devices. */
export async function PATCH(req: Request, { params }: Ctx) {
  const admin = await apiAdmin();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const p = parsed.data;
  if (id === admin.id && (p.role && p.role !== "admin" || p.active === false)) return fail("cannot_demote_self", 400);
  const cur = await q1<{ id: string }>("select id from users where id = $1", [id]);
  if (!cur) return notFound();
  await q1(
    `update users set display_name = coalesce($2, display_name), role = coalesce($3, role), phone = coalesce($4, phone),
            active = coalesce($5, active), password_hash = case when $6::text is null then password_hash else $6 end
      where id = $1 returning id`,
    [id, p.display_name?.normalize("NFC") ?? null, p.role ?? null, p.phone ?? null, p.active ?? null, p.password ? await hashPassword(p.password) : null],
  );
  if (p.active === false) await revokeDevices(id);
  return NextResponse.json({ member: await getTeamMember(id) });
}

/**
 * Deletes a team member (admins only). Devices and sessions go along; tours and log entries
 * keep the history without the reference. Not possible: yourself or the last admin.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const admin = await apiAdmin();
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  if (id === admin.id) return fail("cannot_delete_self", 400);
  const target = await q1<{ role: string; username: string }>("select role, username::text as username from users where id = $1", [id]);
  if (!target) return notFound();
  if (target.role === "admin") {
    const others = await q1<{ n: number }>("select count(*)::int as n from users where role = 'admin' and active and id <> $1", [id]);
    if (!others?.n) return fail("last_admin", 400);
  }
  await q1("delete from users where id = $1 returning id", [id]);
  return NextResponse.json({ ok: true, username: target.username });
}
