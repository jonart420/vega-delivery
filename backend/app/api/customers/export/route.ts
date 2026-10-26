import { NextResponse } from "next/server";
import { apiStaff } from "@/lib/auth";
import { customersToCsv, listCustomers } from "@/lib/customers";

export async function GET() {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const rows = await listCustomers({ includeInactive: true, limit: 1000 });
  return new NextResponse(customersToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
