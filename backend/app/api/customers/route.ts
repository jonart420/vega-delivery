import { NextResponse } from "next/server";
import { readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { createCustomer, CustomerInput, listCustomers } from "@/lib/customers";

export async function GET(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const sp = new URL(req.url).searchParams;
  const customers = await listCustomers({
    search: sp.get("q") ?? undefined,
    includeInactive: sp.get("inactive") === "1",
    limit: Number(sp.get("limit")) || 200,
    offset: Number(sp.get("offset")) || 0,
  });
  return NextResponse.json({ customers });
}

export async function POST(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const parsed = CustomerInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  return NextResponse.json({ customer: await createCustomer(parsed.data) }, { status: 201 });
}
