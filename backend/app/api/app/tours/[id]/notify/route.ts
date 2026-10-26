import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, zodFail } from "@/lib/api";
import { appUser } from "@/lib/app-auth";
import { appTourAccess } from "@/lib/app-tours";
import { q1 } from "@/lib/db";
import { processQueue, queueForStop } from "@/lib/notify";

/** Driver sends a manual notification with the tracking link to a customer. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const access = await appTourAccess(id, user.id);
  if (access instanceof NextResponse) return access;
  const parsed = z.object({ stop_id: z.string().uuid() }).safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const stop = await q1("select id from tour_stops where id = $1 and tour_id = $2", [parsed.data.stop_id, id]);
  if (!stop) return NextResponse.json({ error: "stop not found" }, { status: 404 });
  const queued = await queueForStop(parsed.data.stop_id, "manual", { createdBy: user.id });
  await processQueue();
  return NextResponse.json({ queued });
}
