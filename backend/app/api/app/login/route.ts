import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, readJson } from "@/lib/api";
import { clientIp, issueDeviceToken, noteFailure, tooManyFailures } from "@/lib/app-auth";
import { verifyLoginCode } from "@/lib/login-code";

/** App sign-in: scanned or typed login code → device token. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (tooManyFailures(ip)) return fail("too_many_attempts", 429);
  const parsed = z
    .object({
      code: z.string().min(10).max(500),
      device_name: z.string().max(100).optional(),
      platform: z.enum(["ios", "android"]).optional(),
    })
    .safeParse(await readJson(req));
  if (!parsed.success) return fail("code_missing", 400);
  const user = await verifyLoginCode(parsed.data.code);
  if (!user) {
    noteFailure(ip);
    return fail("code_invalid", 401);
  }
  const token = await issueDeviceToken(user.id, parsed.data.device_name ?? null, parsed.data.platform ?? null);
  return NextResponse.json({
    token,
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, locale: user.locale },
  });
}
