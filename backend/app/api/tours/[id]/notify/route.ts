import { NextResponse } from "next/server";
import { z } from "zod";
import { badId, isUuid, readJson, zodFail } from "@/lib/api";
import { apiStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { processQueue, queueForStop } from "@/lib/notify";

/** Manual notification for one stop (stop_id) or all open stops of the tour. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = z
    .object({ stop_id: z.string().uuid().optional(), channels: z.array(z.enum(["email", "whatsapp"])).optional() })
    .safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const stops = parsed.data.stop_id
    ? await q<{ id: string }>("select id from tour_stops where id = $1 and tour_id = $2", [parsed.data.stop_id, id])
    : await q<{ id: string }>("select id from tour_stops where tour_id = $1 and status in ('pending', 'arrived')", [id]);
  let queued = 0;
  for (const s of stops) queued += await queueForStop(s.id, "manual", { createdBy: user.id, channels: parsed.data.channels });
  await processQueue();
  return NextResponse.json({ queued });
}
