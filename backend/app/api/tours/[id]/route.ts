import { NextResponse } from "next/server";
import { badId, fail, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { deleteTour, getStops, getTour, patchTour, TourLockedError, TourPatch } from "@/lib/tours";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const tour = await getTour(id);
  if (!tour) return notFound();
  return NextResponse.json({ tour, stops: await getStops(id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = TourPatch.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  try {
    if (!(await patchTour(id, parsed.data))) return notFound();
  } catch (e) {
    if (e instanceof TourLockedError) return fail("tour_locked", 409);
    throw e;
  }
  return NextResponse.json({ tour: await getTour(id), stops: await getStops(id) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  try {
    return (await deleteTour(id)) ? NextResponse.json({ ok: true }) : notFound();
  } catch (e) {
    if (e instanceof TourLockedError) return fail("tour_locked", 409);
    throw e;
  }
}
