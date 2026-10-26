import { NextResponse } from "next/server";
import { readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { createTour, getTour, listTours, TourInput } from "@/lib/tours";

export async function GET(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const sp = new URL(req.url).searchParams;
  return NextResponse.json({ tours: await listTours({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined }) });
}

/** Creates a tour; optional order_ids are added right away. */
export async function POST(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const body = (await readJson(req)) as Record<string, unknown>;
  const parsed = TourInput.safeParse(body);
  if (!parsed.success) return zodFail(parsed.error);
  const id = await createTour(parsed.data, user.id);
  const ids = Array.isArray(body.order_ids) ? body.order_ids.filter((v): v is string => typeof v === "string") : [];
  if (ids.length) await (await import("@/lib/tours")).addOrders(id, ids);
  return NextResponse.json({ tour: await getTour(id) }, { status: 201 });
}
