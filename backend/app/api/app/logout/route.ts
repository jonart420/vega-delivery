import { NextResponse } from "next/server";
import { appUser, revokeDevice } from "@/lib/app-auth";

export async function POST(req: Request) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  await revokeDevice(user.device_id);
  return NextResponse.json({ ok: true });
}
