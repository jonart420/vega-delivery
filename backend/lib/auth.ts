import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { fail } from "./api";
import { q, q1 } from "./db";

export const SESSION_COOKIE = "vd_session";
const SESSION_DAYS = 14;

export type Role = "admin" | "dispatcher" | "driver";

export type SessionUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
  locale: string | null;
};

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function createSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await q("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
    sha256(token),
    userId,
    expires,
  ]);
  return { token, expires };
}

export async function destroySession(token: string | undefined) {
  if (token) await q("delete from sessions where token_hash = $1", [sha256(token)]);
}

export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return q1<SessionUser>(
    `select u.id, u.username::text as username, u.display_name, u.role, u.locale
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active`,
    [sha256(token)],
  );
}

export const isStaff = (u: { role: Role }) => u.role === "admin" || u.role === "dispatcher";

/** Pages: no session → /login. Drivers use the app and only see their own data. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireStaff(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isStaff(user)) redirect("/team");
  return user;
}

/** API routes: the user or a 401/403 response. */
export async function apiUser(): Promise<SessionUser | NextResponse> {
  return (await getUser()) ?? fail("unauthorized", 401);
}

export async function apiStaff(): Promise<SessionUser | NextResponse> {
  const user = await getUser();
  if (!user) return fail("unauthorized", 401);
  return isStaff(user) ? user : fail("forbidden", 403);
}

export async function apiAdmin(): Promise<SessionUser | NextResponse> {
  const user = await getUser();
  if (!user) return fail("unauthorized", 401);
  return user.role === "admin" ? user : fail("admin_only", 403);
}
