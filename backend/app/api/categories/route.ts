import { NextResponse } from "next/server";
import { readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { CategoryInput, listCategories } from "@/lib/products";

export async function GET() {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ categories: await listCategories() });
}

export async function POST(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const parsed = CategoryInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const c = await q1("insert into product_categories (name, parent_id, sort) values ($1, $2, $3) returning *", [
    parsed.data.name,
    parsed.data.parent_id ?? null,
    parsed.data.sort,
  ]);
  return NextResponse.json({ category: c }, { status: 201 });
}
