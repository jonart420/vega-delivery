import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";

/** Switches the UI language (cookie + user profile). */
export async function POST(req: Request) {
  const { locale } = (await req.json().catch(() => ({}))) as { locale?: string };
  if (!isLocale(locale)) return NextResponse.json({ error: "unsupported locale" }, { status: 400 });
  const user = await getUser();
  if (user) await q("update users set locale = $2 where id = $1", [user.id, locale]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 365 * 864e2 });
  return res;
}
