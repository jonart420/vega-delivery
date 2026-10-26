import { NextResponse } from "next/server";
import { badId, fail, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { CategoryInput } from "@/lib/products";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = CategoryInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  if (parsed.data.parent_id === id) return fail("category_cycle", 400);
  // Prevent cycles: the new parent must not be a descendant of this category
  if (parsed.data.parent_id) {
    const cycle = await q1(
      `with recursive up as (select id, parent_id from product_categories where id = $1
         union all select c.id, c.parent_id from product_categories c join up on c.id = up.parent_id)
       select 1 from up where id = $2`,
      [parsed.data.parent_id, id],
    );
    if (cycle) return fail("category_cycle", 400);
  }
  const c = await q1("update product_categories set name = $2, parent_id = $3, sort = $4 where id = $1 returning *", [
    id,
    parsed.data.name,
    parsed.data.parent_id ?? null,
    parsed.data.sort,
  ]);
  return c ? NextResponse.json({ category: c }) : notFound();
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const r = await q1("delete from product_categories where id = $1 returning id", [id]);
  return r ? NextResponse.json({ ok: true }) : notFound();
}
