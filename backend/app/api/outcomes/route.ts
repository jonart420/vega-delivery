import { NextResponse } from "next/server";
import { readJson, zodFail } from "@/lib/api";
import { apiAdmin, apiStaff } from "@/lib/auth";
import { listOutcomes, listReasons, OutcomeInput, upsertOutcome } from "@/lib/outcomes";

export async function GET() {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const [outcomes, reasons] = await Promise.all([listOutcomes(), listReasons()]);
  return NextResponse.json({ outcomes, reasons });
}

/** Creates or updates an outcome (by code). */
export async function POST(req: Request) {
  const user = await apiAdmin();
  if (user instanceof NextResponse) return user;
  const parsed = OutcomeInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  return NextResponse.json({ outcome: await upsertOutcome(parsed.data) });
}
