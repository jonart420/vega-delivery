import { z } from "zod";
import { q, q1, tx } from "./db";

/** Delivery outcomes ("Delivered", "Refused", …) and their reasons – both freely extensible. */

export type Outcome = {
  code: string;
  label_en: string;
  label_de: string;
  kind: "success" | "failure" | "neutral";
  icon: string | null;
  color: string | null;
  requires_reason: boolean;
  requires_photo: boolean;
  requires_signature: boolean;
  requires_recipient: boolean;
  requires_scan: boolean;
  final: boolean;
  active: boolean;
  sort: number;
  system: boolean;
};

export type Reason = { id: string; outcome_code: string; label_en: string; label_de: string; active: boolean; sort: number };

export const OutcomeInput = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "lowercase letters, digits, _"),
  label_en: z.string().min(1).max(80).transform((v) => v.normalize("NFC").trim()),
  label_de: z.string().min(1).max(80).transform((v) => v.normalize("NFC").trim()),
  kind: z.enum(["success", "failure", "neutral"]),
  icon: z.string().max(30).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  requires_reason: z.boolean().default(false),
  requires_photo: z.boolean().default(false),
  requires_signature: z.boolean().default(false),
  requires_recipient: z.boolean().default(false),
  requires_scan: z.boolean().default(false),
  final: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().default(100),
});

export const ReasonInput = z.object({
  outcome_code: z.string(),
  label_en: z.string().min(1).max(120).transform((v) => v.normalize("NFC").trim()),
  label_de: z.string().min(1).max(120).transform((v) => v.normalize("NFC").trim()),
  active: z.boolean().default(true),
  sort: z.number().int().default(100),
});

export async function listOutcomes(activeOnly = false): Promise<Outcome[]> {
  return q<Outcome>(`select * from delivery_outcomes ${activeOnly ? "where active" : ""} order by sort, code`);
}

export async function listReasons(activeOnly = false): Promise<Reason[]> {
  return q<Reason>(`select * from delivery_reasons ${activeOnly ? "where active" : ""} order by outcome_code, sort, label_en`);
}

export async function upsertOutcome(input: z.infer<typeof OutcomeInput>): Promise<Outcome> {
  const row = await q1<Outcome>(
    `insert into delivery_outcomes (code, label_en, label_de, kind, icon, color, requires_reason, requires_photo,
       requires_signature, requires_recipient, requires_scan, final, active, sort)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (code) do update set label_en=excluded.label_en, label_de=excluded.label_de,
       kind = case when delivery_outcomes.system then delivery_outcomes.kind else excluded.kind end,
       icon=excluded.icon, color=excluded.color, requires_reason=excluded.requires_reason,
       requires_photo=excluded.requires_photo, requires_signature=excluded.requires_signature,
       requires_recipient=excluded.requires_recipient, requires_scan=excluded.requires_scan,
       final=excluded.final, active = case when delivery_outcomes.system then true else excluded.active end,
       sort=excluded.sort
     returning *`,
    [
      input.code, input.label_en, input.label_de, input.kind, input.icon ?? null, input.color ?? null, input.requires_reason,
      input.requires_photo, input.requires_signature, input.requires_recipient, input.requires_scan, input.final,
      input.active, input.sort,
    ],
  );
  return row!;
}

/** System outcomes cannot be deleted; used ones are deactivated instead of deleted. */
export async function deleteOutcome(code: string): Promise<"deleted" | "deactivated" | "system" | "not_found"> {
  return tx(async (c) => {
    const o = await c.query<{ system: boolean }>("select system from delivery_outcomes where code = $1", [code]);
    if (!o.rows[0]) return "not_found";
    if (o.rows[0].system) return "system";
    const used = await c.query("select 1 from delivery_events where outcome_code = $1 limit 1", [code]);
    if (used.rowCount) {
      await c.query("update delivery_outcomes set active = false where code = $1", [code]);
      return "deactivated";
    }
    await c.query("delete from delivery_outcomes where code = $1", [code]);
    return "deleted";
  });
}
