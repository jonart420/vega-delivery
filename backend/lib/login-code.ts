import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import bwipjs from "bwip-js/node";
import sharp from "sharp";
import type { Role } from "./auth";
import { pool, q, q1 } from "./db";
import { publicBaseUrl } from "./branding";

/**
 * Personal login codes for drivers (scanned as QR code in the app).
 *
 * The database only stores hash + version. The plain code is derived deterministically from
 * LOGIN_CODE_SECRET: HMAC-SHA256(secret, "<userId>:<version>") → first 100 bits → 20 characters
 * Crockford Base32. It can be shown/printed again at any time without being stored.
 *
 * QR format v3 (see docs/APP-API.md):
 *   vegadelivery://login?v=3&s=<server base URL, URL-encoded>&c=<20 character code>
 * The server URL is part of the code, so self-hosted instances need no app changes.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LEN = 20; // 20 × 5 bit = 100 bit
export const QR_SCHEME = "vegadelivery://login";

export class LoginCodeConfigError extends Error {}

function secret(): Buffer {
  const s = process.env.LOGIN_CODE_SECRET;
  if (!s) throw new LoginCodeConfigError("LOGIN_CODE_SECRET is missing (.env). Generate: openssl rand -base64 48");
  const buf = Buffer.from(s, "utf8");
  if (buf.length < 32) {
    throw new LoginCodeConfigError(
      `LOGIN_CODE_SECRET is too short (${buf.length} bytes, min. 32). Generate: openssl rand -base64 48`,
    );
  }
  return buf;
}

/** Configuration problem as text, or null. */
export function loginCodeConfigProblem(): string | null {
  try {
    secret();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function toCrockford(bytes: Buffer, chars: number): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  let i = 0;
  while (out.length < chars) {
    if (bits < 5) {
      acc = ((acc << 8) | bytes[i++]) & 0xffff;
      bits += 8;
    }
    out += CROCKFORD[(acc >> (bits - 5)) & 31];
    bits -= 5;
  }
  return out;
}

export function deriveLoginCode(userId: string, version: number): string {
  const mac = createHmac("sha256", secret()).update(`${userId}:${version}`).digest();
  return toCrockford(mac, CODE_LEN);
}

export function hashLoginCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Display: ABCD-EFGH-JKMN-PQRS-TVWX */
export function groupCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** Server URL written into the QR code (APP_SERVER_URL, else PUBLIC_BASE_URL). */
export function appServerUrl(): string {
  return (process.env.APP_SERVER_URL || publicBaseUrl()).replace(/\/$/, "");
}

export function qrPayload(code: string, server = appServerUrl()): string {
  return `${QR_SCHEME}?v=3&s=${encodeURIComponent(server)}&c=${code}`;
}

/**
 * Tolerant normalization of typed or scanned input: accepts the v3 URI, grouped codes with
 * dashes/spaces and Crockford look-alikes (I/L → 1, O → 0).
 */
export function normalizeLoginCode(input: string): string | null {
  let s = input.trim();
  if (s.toLowerCase().startsWith(QR_SCHEME)) {
    try {
      s = new URL(s).searchParams.get("c") ?? "";
    } catch {
      return null;
    }
  }
  s = s
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (s.length !== CODE_LEN) return null;
  for (const c of s) if (!CROCKFORD.includes(c)) return null;
  return s;
}

// ── DB ────────────────────────────────────────────────────────────────────

type CodeRow = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
  active: boolean;
  user_no: number;
  phone: string | null;
  login_code_version: number;
  login_code_hash: string | null;
  login_code_created_at: Date | null;
  login_code_revoked_at: Date | null;
};

const CODE_COLS = `id, username::text as username, display_name, role, active, user_no, phone,
  login_code_version, login_code_hash, login_code_created_at, login_code_revoked_at`;

export type CodeState =
  | { status: "none" }
  | { status: "hidden" }
  | { status: "revoked"; revoked_at: string }
  | { status: "invalid"; reason: string }
  | { status: "valid"; code: string; grouped: string; version: number; created_at: string | null };

export type TeamMember = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
  active: boolean;
  user_no: number;
  phone: string | null;
  code: CodeState;
};

/** Code state incl. check "derived plain code matches the stored hash". */
function codeState(r: CodeRow): CodeState {
  if (r.login_code_revoked_at) return { status: "revoked", revoked_at: r.login_code_revoked_at.toISOString() };
  if (r.login_code_version <= 0 || !r.login_code_hash) return { status: "none" };
  let code: string;
  try {
    code = deriveLoginCode(r.id, r.login_code_version);
  } catch (e) {
    return { status: "invalid", reason: (e as Error).message };
  }
  const a = Buffer.from(hashLoginCode(code), "hex");
  const b = Buffer.from(r.login_code_hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { status: "invalid", reason: "LOGIN_CODE_SECRET changed – generate a new code" };
  }
  return {
    status: "valid",
    code,
    grouped: groupCode(code),
    version: r.login_code_version,
    created_at: r.login_code_created_at?.toISOString() ?? null,
  };
}

function toMember(r: CodeRow): TeamMember {
  return {
    id: r.id,
    username: r.username,
    display_name: r.display_name,
    role: r.role,
    active: r.active,
    user_no: r.user_no,
    phone: r.phone,
    code: codeState(r),
  };
}

/** Plain codes are only visible to admins and the owner – a code signs you in as that person. */
export function canSeeCode(viewer: { id: string; role: Role }, memberId: string): boolean {
  return viewer.role === "admin" || viewer.id === memberId;
}

export function redactForViewer(members: TeamMember[], viewer: { id: string; role: Role }): TeamMember[] {
  return members.map((m) =>
    canSeeCode(viewer, m.id) || m.code.status !== "valid" ? m : { ...m, code: { status: "hidden" } },
  );
}

export async function listTeam(): Promise<TeamMember[]> {
  const rows = await q<CodeRow>(`select ${CODE_COLS} from users order by active desc, username`);
  return rows.map(toMember);
}

export async function getTeamMember(userId: string): Promise<TeamMember | null> {
  const r = await q1<CodeRow>(`select ${CODE_COLS} from users where id = $1`, [userId]);
  return r ? toMember(r) : null;
}

/** New code: version +1, new hash, revocation lifted. */
export async function generateLoginCode(userId: string): Promise<TeamMember | null> {
  secret();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const cur = await client.query<{ login_code_version: number }>(
      "select login_code_version from users where id = $1 for update",
      [userId],
    );
    if (!cur.rows[0]) {
      await client.query("rollback");
      return null;
    }
    const version = cur.rows[0].login_code_version + 1;
    const hash = hashLoginCode(deriveLoginCode(userId, version));
    await client.query(
      `update users set login_code_version = $2, login_code_hash = $3,
              login_code_created_at = now(), login_code_revoked_at = null
        where id = $1`,
      [userId, version, hash],
    );
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return getTeamMember(userId);
}

/** Revoke: delete hash → printed code becomes invalid. */
export async function revokeLoginCode(userId: string): Promise<TeamMember | null> {
  const r = await q1<{ id: string }>(
    "update users set login_code_hash = null, login_code_revoked_at = now() where id = $1 returning id",
    [userId],
  );
  return r ? getTeamMember(userId) : null;
}

/** App sign-in: plain code (tolerant) → active user or null. */
export async function verifyLoginCode(
  plain: string,
): Promise<{ id: string; username: string; display_name: string | null; role: Role; locale: string | null } | null> {
  const code = normalizeLoginCode(plain);
  if (!code) return null;
  return q1(
    `select id, username::text as username, display_name, role, locale from users
      where login_code_hash = $1 and login_code_revoked_at is null and active`,
    [hashLoginCode(code)],
  );
}

// ── PNG ───────────────────────────────────────────────────────────────────

const PNG_SIZE = 1024;
const QUIET = 56;
const TEXT_BLOCK = 150;

export const escXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Printable 1024×1024 PNG: QR code as large as possible, username and grouped code below. */
export async function renderLoginCodePng(opts: { code: string; username: string }): Promise<Buffer> {
  const symbol = await bwipjs.toBuffer({
    bcid: "qrcode",
    text: qrPayload(opts.code),
    eclevel: "M",
    scale: 1,
    paddingwidth: 0,
    paddingheight: 0,
    backgroundcolor: "FFFFFF",
  } as Parameters<typeof bwipjs.toBuffer>[0]);

  const boxW = PNG_SIZE - 2 * QUIET;
  const boxH = PNG_SIZE - 2 * QUIET - TEXT_BLOCK;
  const meta = await sharp(symbol).metadata();
  const factor = Math.max(1, Math.floor(Math.min(boxW, boxH) / Math.max(meta.width ?? 1, meta.height ?? 1)));
  const { data: symPng, info } = await sharp(symbol)
    .resize((meta.width ?? 1) * factor, (meta.height ?? 1) * factor, { kernel: "nearest" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((PNG_SIZE - info.width) / 2);
  const top = QUIET + Math.round((boxH - info.height) / 2);

  const textTop = PNG_SIZE - QUIET - TEXT_BLOCK;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PNG_SIZE}" height="${TEXT_BLOCK}">
  <text x="50%" y="62" text-anchor="middle" font-family="Helvetica, Arial, DejaVu Sans, sans-serif"
        font-size="52" font-weight="700" fill="#000">${escXml(opts.username)}</text>
  <text x="50%" y="128" text-anchor="middle" font-family="Menlo, DejaVu Sans Mono, Courier New, monospace"
        font-size="44" fill="#000">${escXml(groupCode(opts.code))}</text>
</svg>`;

  return sharp({ create: { width: PNG_SIZE, height: PNG_SIZE, channels: 3, background: "#ffffff" } })
    .composite([
      { input: symPng, left, top },
      { input: Buffer.from(svg), left: 0, top: textTop + 10 },
    ])
    .png()
    .toBuffer();
}
