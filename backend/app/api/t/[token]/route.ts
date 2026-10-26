import { NextResponse } from "next/server";
import { publicTracking } from "@/lib/tracking";

export const dynamic = "force-dynamic";

// Light brake per IP: max. 60 requests per minute (page polls every 15 s)
const hits = new Map<string, number[]>();

/** Public tracking data (no login). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= 60) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10_000) hits.clear();

  const { token } = await params;
  const data = await publicTracking(token);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
