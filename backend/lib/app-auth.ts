import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { fail } from "./api";
import { q, q1 } from "./db";

/** Authentication of the driver apps (iOS/Android) via device token (Authorization: Bearer …). */

export type AppUser = {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  locale: string | null;
  device_id: string;
};

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function issueDeviceToken(userId: string, name: string | null, platform: string | null): Promise<string> {
  const token = "vdd_" + randomBytes(32).toString("base64url");
  await q("insert into devices (user_id, token_hash, name, platform) values ($1, $2, $3, $4)", [
    userId,
    sha256(token),
    name,
    platform,
  ]);
  return token;
}

export async function appUser(req: Request): Promise<AppUser | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return fail("unauthorized", 401);
  const user = await q1<AppUser>(
    `update devices d set last_seen_at = now()
       from users u
      where d.token_hash = $1 and d.revoked_at is null and u.id = d.user_id and u.active
     returning u.id, u.username::text as username, u.display_name, u.role, u.locale, d.id as device_id`,
    [sha256(token)],
  );
  return user ?? fail("device_revoked", 401);
}

export async function revokeDevice(deviceId: string) {
  await q("update devices set revoked_at = now() where id = $1", [deviceId]);
}

/** Signs out all devices of a team member (e.g. when the login code is revoked). */
export async function revokeDevices(userId: string) {
  await q("update devices set revoked_at = now() where user_id = $1 and revoked_at is null", [userId]);
}

// Simple brake against guessing: max. 10 failures per minute and IP.
const failures = new Map<string, number[]>();
export function tooManyFailures(ip: string): boolean {
  const now = Date.now();
  const list = (failures.get(ip) ?? []).filter((t) => now - t < 60_000);
  failures.set(ip, list);
  return list.length >= 10;
}
export function noteFailure(ip: string) {
  failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
