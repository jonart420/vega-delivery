import { NextResponse } from "next/server";
import { fail, notFound } from "@/lib/api";
import { apiAdmin } from "@/lib/auth";
import { deleteOutcome } from "@/lib/outcomes";

export async function DELETE(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await apiAdmin();
  if (user instanceof NextResponse) return user;
  const { code } = await params;
  const r = await deleteOutcome(code);
  if (r === "not_found") return notFound();
  if (r === "system") return fail("outcome_system", 409);
  return NextResponse.json({ result: r });
}
