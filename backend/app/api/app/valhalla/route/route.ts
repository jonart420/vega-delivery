import { NextResponse } from "next/server";
import { appUser } from "@/lib/app-auth";
import { VALHALLA_URL, valhallaLanguage } from "@/lib/valhalla";

const MAX_BODY = 256 * 1024;
const MAX_LOCATIONS = 25;
const COSTINGS = new Set(["auto", "bicycle", "pedestrian"]);

/**
 * Routing proxy for turn-by-turn navigation (Ferrostar): passes the Valhalla /route request through,
 * only guarding profile, number of locations and the instruction language.
 * For cars the app sends the vehicle heading with the first location – Valhalla then starts in the
 * driving direction instead of suggesting an illegal U-turn.
 */
export async function POST(req: Request) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;

  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY) {
    return NextResponse.json({ error: "request too large" }, { status: 413 });
  }
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: "request too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (typeof body.costing !== "string" || !COSTINGS.has(body.costing)) {
    return NextResponse.json({ error: "costing must be auto, bicycle or pedestrian" }, { status: 400 });
  }
  if (!Array.isArray(body.locations) || body.locations.length < 2) {
    return NextResponse.json({ error: "at least two locations required" }, { status: 400 });
  }
  if (body.locations.length > MAX_LOCATIONS) {
    return NextResponse.json({ error: `at most ${MAX_LOCATIONS} locations` }, { status: 400 });
  }
  if (body.costing === "auto") {
    // Arrive on the curb side of the destination (no crossing of the road with the parcel)
    body.locations = (body.locations as Record<string, unknown>[]).map((loc, i, all) =>
      i === all.length - 1 ? { ...(loc ?? {}), preferred_side: (loc as Record<string, unknown>)?.preferred_side ?? "same" } : loc,
    );
  }
  const dir =
    body.directions_options && typeof body.directions_options === "object" && !Array.isArray(body.directions_options)
      ? (body.directions_options as Record<string, unknown>)
      : {};
  if (!dir.language) dir.language = valhallaLanguage(user.locale ?? process.env.DEFAULT_LOCALE ?? "en");
  body.directions_options = dir;

  let res: Response;
  try {
    res = await fetch(`${VALHALLA_URL}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json({ error: "Valhalla unreachable" }, { status: 502 });
  }
  let out: string;
  try {
    out = await res.text();
  } catch {
    return NextResponse.json({ error: "Valhalla response aborted" }, { status: 502 });
  }
  return new Response(out, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}
