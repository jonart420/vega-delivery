import { NextResponse } from "next/server";
import { appUser } from "@/lib/app-auth";

export async function GET(req: Request) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const { device_id: _d, ...rest } = user;
  return NextResponse.json({ user: rest });
}
