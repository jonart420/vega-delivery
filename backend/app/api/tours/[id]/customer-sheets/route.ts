import { NextResponse } from "next/server";
import { badId, isUuid } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import { customerSheetsPdf } from "@/lib/labels";

/** Customer barcode sheets for all customers of a tour (e.g. for first deliveries). ?format=a4|a6 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const rows = await q<{ customer_id: string }>("select customer_id from tour_stops where tour_id = $1", [id]);
  const format = new URL(req.url).searchParams.get("format") === "a6" ? "a6" : "a4";
  const pdf = await customerSheetsPdf(rows.map((r) => r.customer_id), await getLocale(), format);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="customer-barcodes.pdf"` },
  });
}
