import { NextResponse } from "next/server";
import { badId, isUuid } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import { labelsPdf } from "@/lib/labels";

/** All delivery labels of a tour in driving order (PDF). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const rows = await q<{ order_id: string }>(
    "select tso.order_id from tour_stop_orders tso join tour_stops s on s.id = tso.stop_id where s.tour_id = $1",
    [id],
  );
  const pdf = await labelsPdf(rows.map((r) => r.order_id), await getLocale());
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="labels-${id.slice(0, 8)}.pdf"` },
  });
}
