import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { getT } from "./i18n";

/** Helpers for route handlers: localized JSON errors, id checks, validation errors. */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

export async function fail(key: string, status: number, vars?: Record<string, string | number>) {
  const { t } = await getT();
  return NextResponse.json({ error: t(`errors.${key}`, vars), code: key }, { status });
}

export const notFound = () => fail("not_found", 404);
export const badId = () => fail("invalid_id", 400);

/** First zod issue as "path: message". */
export function zodFail(err: ZodError) {
  const i = err.issues[0];
  const path = i?.path.map(String).join(".") || "body";
  return NextResponse.json({ error: i ? `${path}: ${i.message}` : "Invalid data", code: "validation" }, { status: 400 });
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => ({}));
}

/** Trims, NFC-normalizes (umlauts typed on macOS arrive decomposed) and empties → null. */
export function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.normalize("NFC").trim();
  return s ? s : null;
}
