import { NextResponse } from "next/server";
import { badId, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { ProductInput } from "@/lib/products";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = ProductInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const p = parsed.data;
  try {
    const r = await q1(
      `update products set category_id=$2, sku=$3, name=$4, description=$5, unit=$6, price_cents=$7, vat_rate=$8, ean13=$9,
         weight_g=$10, active=$11, updated_at=now() where id=$1 returning id`,
      [id, p.category_id ?? null, p.sku, p.name, p.description, p.unit, p.price_cents, p.vat_rate, p.ean13, p.weight_g ?? null, p.active],
    );
    return r ? NextResponse.json({ ok: true }) : notFound();
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    throw e;
  }
}

/** Order items keep a name snapshot, so products can be deleted; the link is set to null. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const r = await q1("delete from products where id = $1 returning id", [id]);
  return r ? NextResponse.json({ ok: true }) : notFound();
}
