import { NextResponse, type NextRequest } from "next/server";
import { envLockProblems } from "./lib/env-check";

/**
 * 1. Security gate: while production secrets are insecure, every page shows /system-locked and
 *    every API answers 503 (health stays reachable for monitoring).
 * 2. Optimistic auth check: no session cookie → /login (real check in requireUser()/apiUser()).
 */
const PUBLIC_PAGES = [/^\/login/, /^\/t\//, /^\/system-locked/, /^\/branding\//];

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (envLockProblems().length) {
    if (path.startsWith("/api/")) {
      if (path === "/api/health") return NextResponse.next();
      return NextResponse.json(
        { error: "System locked: insecure configuration. Use strong passwords in .env and restart.", code: "insecure_configuration" },
        { status: 503 },
      );
    }
    if (path.startsWith("/system-locked") || path.startsWith("/branding/")) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/system-locked";
    url.search = "";
    return NextResponse.rewrite(url, { status: 503 });
  }
  if (path.startsWith("/system-locked")) return NextResponse.redirect(new URL("/", req.url));
  if (path.startsWith("/api/") || PUBLIC_PAGES.some((r) => r.test(path))) return NextResponse.next();
  if (!req.cookies.get("vd_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
