import { NextResponse } from "next/server";
import { badId, isUuid } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { customerSheetsPdf } from "@/lib/labels";

/** One-page customer barcode sheet to leave at the customer. ?format=a4|a6 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const format = new URL(req.url).searchParams.get("format") === "a6" ? "a6" : "a4";
  const pdf = await customerSheetsPdf([id], await getLocale(), format);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="customer-barcode.pdf"` },
  });
}
