import { NextResponse } from "next/server";
import { clientIp, noteFailure, tooManyFailures } from "@/lib/app-auth";
import { fail } from "@/lib/api";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { verifyPassword } from "@/lib/password";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (tooManyFailures(ip)) return fail("too_many_attempts", 429);
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) return fail("credentials_missing", 400);
  const user = await q1<{ id: string; password_hash: string | null; locale: string | null }>(
    "select id, password_hash, locale from users where username = $1 and active",
    [username],
  );
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    noteFailure(ip);
    return fail("login_failed", 401);
  }
  const { token, expires } = await createSession(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires,
  });
  if (user.locale) res.cookies.set(LOCALE_COOKIE, user.locale, { path: "/", sameSite: "lax", maxAge: 365 * 864e2 });
  return res;
}
