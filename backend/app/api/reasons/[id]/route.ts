import { NextResponse } from "next/server";
import { badId, isUuid, notFound, readJson, zodFail } from "@/lib/api";
import { apiAdmin } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { ReasonInput } from "@/lib/outcomes";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const user = await apiAdmin();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const parsed = ReasonInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const r = parsed.data;
  const reason = await q1(
    "update delivery_reasons set outcome_code=$2, label_en=$3, label_de=$4, active=$5, sort=$6 where id=$1 returning *",
    [id, r.outcome_code, r.label_en, r.label_de, r.active, r.sort],
  );
  return reason ? NextResponse.json({ reason }) : notFound();
}

/** Reasons used in the log are deactivated (the log keeps its reference); unused ones are deleted. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await apiAdmin();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!isUuid(id)) return badId();
  const used = await q1("select 1 from delivery_events where reason_id = $1 limit 1", [id]);
  const r = used
    ? await q1("update delivery_reasons set active = false where id = $1 returning id", [id])
    : await q1("delete from delivery_reasons where id = $1 returning id", [id]);
  return r ? NextResponse.json({ ok: true, deactivated: !!used }) : notFound();
}
