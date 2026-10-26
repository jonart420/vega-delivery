import { NextResponse } from "next/server";
import { fail, zodFail } from "@/lib/api";
import { appUser } from "@/lib/app-auth";
import { appTourAccess } from "@/lib/app-tours";
import { EventInput, EventValidationError, recordEvent } from "@/lib/deliveries";
import { onStopCompleted } from "@/lib/notify";
import { recomputeLiveEtas } from "@/lib/tours";
import { q1 } from "@/lib/db";
import { storeProofFile } from "@/lib/uploads";

/**
 * Delivery event from the app (outcome, arrival, note). Either JSON, or multipart/form-data with a
 * `meta` field (the same JSON) plus optional `photo` and `signature` image files.
 * Idempotent via client_id – the app's outbox may resend.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const access = await appTourAccess(id, user.id);
  if (access instanceof NextResponse) return access;
  if (access.status !== "in_progress") return fail("tour_not_running", 409);

  let raw: unknown;
  let photo: File | null = null;
  let signature: File | null = null;
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return fail("invalid_body", 400);
    try {
      raw = JSON.parse(String(form.get("meta") ?? "{}"));
    } catch {
      return fail("invalid_body", 400);
    }
    const p = form.get("photo");
    const s = form.get("signature");
    photo = p instanceof File && p.size ? p : null;
    signature = s instanceof File && s.size ? s : null;
  } else {
    raw = await req.json().catch(() => ({}));
  }
  const parsed = EventInput.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);

  let files: { photo_path?: string | null; signature_path?: string | null } = {};
  try {
    files = {
      photo_path: photo ? await storeProofFile(photo, "photo") : null,
      signature_path: signature ? await storeProofFile(signature, "signature") : null,
    };
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, code: "invalid_file" }, { status: 400 });
  }

  try {
    const r = await recordEvent(id, parsed.data, { userId: user.id, deviceId: user.device_id }, files);
    if (!r.duplicate && parsed.data.type === "outcome") {
      await onStopCompleted(id, parsed.data.stop_id, r.outcome_kind as "success" | "failure" | "neutral" | null);
      const pos = await q1<{ lat: number; lon: number }>("select lat, lon from live_positions where tour_id = $1", [id]);
      if (pos) void recomputeLiveEtas(id, pos, true);
    }
    return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof EventValidationError) return fail(`event_${e.code}`, 422);
    throw e;
  }
}
