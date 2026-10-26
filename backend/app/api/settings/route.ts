import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, zodFail } from "@/lib/api";
import { apiAdmin, apiStaff } from "@/lib/auth";
import { notifyStatus } from "@/lib/notify";
import { getSettings, SettingSchemas, setSetting, type SettingKey } from "@/lib/settings";

export async function GET() {
  const user = await apiStaff();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ settings: await getSettings(), channels: notifyStatus() });
}

/** Saves one settings group (admins only). */
export async function PUT(req: Request) {
  const user = await apiAdmin();
  if (user instanceof NextResponse) return user;
  const parsed = z
    .object({ key: z.enum(Object.keys(SettingSchemas) as [SettingKey, ...SettingKey[]]), value: z.unknown() })
    .safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const check = SettingSchemas[parsed.data.key].safeParse(parsed.data.value);
  if (!check.success) return zodFail(check.error);
  return NextResponse.json({ value: await setSetting(parsed.data.key, check.data) });
}
