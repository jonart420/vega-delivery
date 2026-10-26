import { NextResponse } from "next/server";
import { badId, isUuid, notFound } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { customerDisplayName, renderCustomerIndicator } from "@/lib/barcodes";
import { getCustomer } from "@/lib/customers";

/** Customer indicator: EAN-8 composite (customer number + name). ?format=svg|png, ?download=1 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const c = await getCustomer(id);
  if (!c) return notFound();
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "svg" ? "svg" : "png";
  const out = await renderCustomerIndicator(c.customer_no, customerDisplayName(c), format);
  const headers: Record<string, string> = {
    "Content-Type": format === "svg" ? "image/svg+xml" : "image/png",
    "Cache-Control": "private, max-age=60",
  };
  if (sp.get("download")) headers["Content-Disposition"] = `attachment; filename="customer-${c.customer_no}.${format}"`;
  return new NextResponse(typeof out === "string" ? out : new Uint8Array(out), { headers });
}
