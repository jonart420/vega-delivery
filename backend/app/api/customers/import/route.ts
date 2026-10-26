import { NextResponse } from "next/server";
import { apiStaff } from "@/lib/auth";
import { createCustomer, csvRowToInput, CustomerInput, parseCsv } from "@/lib/customers";

/** CSV import (UTF-8, ; or , separated, header row with the column names of the export). */
export async function POST(req: Request) {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const text = await req.text();
  if (text.length > 5 * 1024 * 1024) return NextResponse.json({ error: "file too large (max. 5 MB)" }, { status: 413 });
  const rows = parseCsv(text);
  let created = 0;
  const errors: { row: number; error: string }[] = [];
  for (const [i, r] of rows.entries()) {
    const parsed = CustomerInput.safeParse(csvRowToInput(r));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ row: i + 2, error: `${issue?.path.join(".")}: ${issue?.message}` });
      continue;
    }
    try {
      await createCustomer(parsed.data);
      created++;
    } catch (e) {
      errors.push({ row: i + 2, error: (e as Error).message });
    }
  }
  return NextResponse.json({ created, errors, total: rows.length });
}
