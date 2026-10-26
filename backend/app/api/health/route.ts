import { NextResponse } from "next/server";
import { q1 } from "@/lib/db";
import { envLockProblems } from "@/lib/env-check";
import { migrationError } from "@/lib/migrate";

export const dynamic = "force-dynamic";

export async function GET() {
  const locked = envLockProblems().length > 0;
  try {
    await q1("select 1");
    const last = await q1<{ name: string }>("select max(name) as name from schema_migrations").catch(() => null);
    return NextResponse.json(
      { ok: !migrationError() && !locked, locked, db: true, schema: last?.name ?? null, migration_error: migrationError() },
      { status: locked ? 503 : 200 },
    );
  } catch {
    return NextResponse.json({ ok: false, locked, db: false }, { status: 503 });
  }
}
