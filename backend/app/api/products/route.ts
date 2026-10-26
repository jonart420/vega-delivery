import { NextResponse } from "next/server";
import { readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { listProducts, ProductInput } from "@/lib/products";

export async function GET(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const inactive = new URL(req.url).searchParams.get("inactive") === "1";
  return NextResponse.json({ products: await listProducts({ includeInactive: inactive }) });
}

export async function POST(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const parsed = ProductInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const p = parsed.data;
  try {
    const row = await q1(
      `insert into products (category_id, sku, name, description, unit, price_cents, vat_rate, ean13, weight_g, active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [p.category_id ?? null, p.sku, p.name, p.description, p.unit, p.price_cents, p.vat_rate, p.ean13, p.weight_g ?? null, p.active],
    );
    return NextResponse.json({ id: row!.id }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return NextResponse.json({ error: "SKU already exists" }, { status: 409 });
    throw e;
  }
}
