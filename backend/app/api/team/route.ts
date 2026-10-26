import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, readJson, zodFail } from "@/lib/api";
import { apiAdmin, apiUser } from "@/lib/auth";
import { q1 } from "@/lib/db";
import {
  generateLoginCode,
  getTeamMember,
  listTeam,
  LoginCodeConfigError,
  loginCodeConfigProblem,
  redactForViewer,
} from "@/lib/login-code";
import { hashPassword } from "@/lib/password";

/** Team list; plain codes only for admins or the own entry. */
export async function GET() {
  const user = await apiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ members: redactForViewer(await listTeam(), user), configError: loginCodeConfigProblem() });
}

const CreateSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9._-]{2,32}$/, "2–32 characters: letters, digits, . _ -"),
  display_name: z.string().trim().max(80).optional().nullable().transform((v) => v?.normalize("NFC") || null),
  role: z.enum(["driver", "dispatcher", "admin"]).default("driver"),
  phone: z.string().trim().max(40).optional().nullable(),
  password: z
    .string()
    .max(200)
    .optional()
    .nullable()
    .refine((v) => !v || v.length >= 12, "password: at least 12 characters"),
});

/** Creates a team member (admins only) and generates a login code right away. */
export async function POST(req: Request) {
  const admin = await apiAdmin();
  if (admin instanceof NextResponse) return admin;
  const parsed = CreateSchema.safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const { username, display_name, role, password, phone } = parsed.data;

  const created = await q1<{ id: string }>(
    `insert into users (username, display_name, role, password_hash, phone)
     values ($1, $2, $3, $4, $5) on conflict (username) do nothing returning id`,
    [username, display_name, role, password ? await hashPassword(password) : null, phone || null],
  );
  if (!created) return fail("username_taken", 409, { username });

  try {
    return NextResponse.json({ member: await generateLoginCode(created.id) }, { status: 201 });
  } catch (e) {
    if (e instanceof LoginCodeConfigError) {
      return NextResponse.json({ member: await getTeamMember(created.id), warning: e.message }, { status: 201 });
    }
    throw e;
  }
}
