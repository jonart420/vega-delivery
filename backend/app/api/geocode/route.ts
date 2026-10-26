import { NextResponse } from "next/server";
import { apiStaff } from "@/lib/auth";
import { geocode } from "@/lib/geocode";
import { getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** Place search: ?q=…&lat=…&lon=… (map centre as bias). */
export async function GET(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  const near = sp.has("lat") && sp.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  try {
    return NextResponse.json({ results: await geocode(sp.get("q") ?? "", { near, locale: await getLocale() }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, results: [] }, { status: 502 });
  }
}
