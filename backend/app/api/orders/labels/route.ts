import { NextResponse } from "next/server";
import { isUuid } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { labelsPdf } from "@/lib/labels";

/** Delivery labels (PDF, 100 × 150 mm) for ?ids=<uuid>,<uuid>,… */
export async function GET(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(isUuid).slice(0, 500);
  if (!ids.length) return NextResponse.json({ error: "ids missing" }, { status: 400 });
  const pdf = await labelsPdf(ids, await getLocale());
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="labels.pdf"` },
  });
}
