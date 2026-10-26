import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { customerSheetsPdf } from "@/lib/labels";

/** Customer barcode sheets (EAN-8 composite, one page each) for ?ids=…&format=a4|a6 */
export async function GET(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const sp = new URL(req.url).searchParams;
  const ids = (sp.get("ids") ?? "").split(",").filter(isUuid).slice(0, 1000);
  if (!ids.length) return NextResponse.json({ error: "ids missing" }, { status: 400 });
  const pdf = await customerSheetsPdf(ids, await getLocale(), sp.get("format") === "a6" ? "a6" : "a4");
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="customer-barcodes.pdf"` },
  });
}
