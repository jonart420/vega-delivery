import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, zodFail } from "@/lib/api";
import { appUser } from "@/lib/app-auth";
import { appTourAccess } from "@/lib/app-tours";
import { q } from "@/lib/db";
import { recomputeLiveEtas } from "@/lib/tours";

const Point = z.object({
  t: z.string().datetime({ offset: true }),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  acc: z.number().min(0).max(10000).nullish(),
  speed: z.number().min(-1).max(200).nullish(),
  heading: z.number().min(-1).max(360).nullish(),
});

/**
 * GPS points from the app while the tour is running (every ~15 s / 100 m, batched when offline).
 * The newest point becomes the live position for tracking links and the dispatcher map.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const access = await appTourAccess(id, user.id);
  if (access instanceof NextResponse) return access;
  if (access.status !== "in_progress") return NextResponse.json({ accepted: 0, status: access.status });
  const parsed = z.object({ points: z.array(Point).min(1).max(2000) }).safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const pts = parsed.data.points;

  await q(
    `insert into track_points (tour_id, device_id, t, lat, lon, acc, speed, heading)
     select $1, $2, x.t, x.lat, x.lon, x.acc, x.speed, x.heading
       from jsonb_to_recordset($3::jsonb) as x(t timestamptz, lat float8, lon float8, acc real, speed real, heading real)`,
    [id, user.device_id, JSON.stringify(pts)],
  );
  const latest = pts.reduce((a, b) => (Date.parse(b.t) > Date.parse(a.t) ? b : a));
  await q(
    `insert into live_positions (tour_id, device_id, t, lat, lon, acc, speed, heading) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (tour_id) do update set device_id = excluded.device_id, t = excluded.t, lat = excluded.lat, lon = excluded.lon,
       acc = excluded.acc, speed = excluded.speed, heading = excluded.heading
     where live_positions.t <= excluded.t`,
    [id, user.device_id, latest.t, latest.lat, latest.lon, latest.acc ?? null, latest.speed ?? null, latest.heading ?? null],
  );
  void recomputeLiveEtas(id, latest);
  return NextResponse.json({ accepted: pts.length });
}
