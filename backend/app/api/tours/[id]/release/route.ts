import { NextResponse } from "next/server";
import { badId, fail, isUuid } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { getTour, releaseTour, unreleaseTour } from "@/lib/tours";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const r = await releaseTour(id);
  if (!r.ok) return fail(`release_${r.reason}`, r.reason === "not_found" ? 404 : 409);
  return NextResponse.json({ tour: await getTour(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  await unreleaseTour(id);
  return NextResponse.json({ tour: await getTour(id) });
}
