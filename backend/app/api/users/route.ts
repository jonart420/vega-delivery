import { NextResponse } from "next/server";
import { apiStaff } from "@/lib/auth";
import { q } from "@/lib/db";

/** Active team members for driver selection. */
export async function GET() {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  const users = await q(
    "select id, username::text as username, display_name, role from users where active order by role = 'driver' desc, coalesce(display_name, username::text)",
  );
  return NextResponse.json({ users });
}
