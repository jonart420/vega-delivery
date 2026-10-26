import { NextResponse } from "next/server";
import { badId, isUuid } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { finishTour, getTour } from "@/lib/tours";

/** Dispatcher closes a running tour (e.g. driver forgot); open stops count as skipped. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  await finishTour(id);
  return NextResponse.json({ tour: await getTour(id) });
}
