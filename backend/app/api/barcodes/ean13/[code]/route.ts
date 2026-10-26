import { NextResponse } from "next/server";
import { apiStaff } from "@/lib/auth";
import { isValidGtin, renderEan13 } from "@/lib/barcodes";

/** EAN-13 barcode image. ?format=svg|png */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { code } = await params;
  if (!isValidGtin(code, 13)) return NextResponse.json({ error: "invalid EAN-13" }, { status: 400 });
  const format = new URL(req.url).searchParams.get("format") === "svg" ? "svg" : "png";
  const out = await renderEan13(code, format);
  return new NextResponse(typeof out === "string" ? out : new Uint8Array(out), {
    headers: { "Content-Type": format === "svg" ? "image/svg+xml" : "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
