import { NextResponse } from "next/server";
import { badId, isUuid, notFound } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { tourSheetPdf } from "@/lib/labels";

/** Loading list (A4 PDF). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const pdf = await tourSheetPdf(id, await getLocale());
  if (!pdf) return notFound();
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="tour-${id.slice(0, 8)}.pdf"` },
  });
}
