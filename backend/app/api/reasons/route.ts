import { NextResponse } from "next/server";
import { readJson, zodFail } from "@/lib/api";
import { apiAdmin } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { ReasonInput } from "@/lib/outcomes";

export async function POST(req: Request) {
  const user = await apiAdmin();
  if (user instanceof NextResponse) return user;
  const parsed = ReasonInput.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const r = parsed.data;
  try {
    const reason = await q1(
      "insert into delivery_reasons (outcome_code, label_en, label_de, active, sort) values ($1,$2,$3,$4,$5) returning *",
      [r.outcome_code, r.label_en, r.label_de, r.active, r.sort],
    );
    return NextResponse.json({ reason }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "unknown outcome" }, { status: 400 });
  }
}
