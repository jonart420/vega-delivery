import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, zodFail } from "@/lib/api";
import { apiAdmin } from "@/lib/auth";
import { brandName, publicBaseUrl } from "@/lib/branding";
import { getLocale } from "@/lib/i18n";
import { makeT } from "@/lib/i18n-core";
import { normalizePhone } from "@/lib/customers";
import { sendEmail } from "@/lib/notify/email";
import { DEFAULT_TEMPLATES, renderTemplate } from "@/lib/notify/templates";
import { sendWhatsApp } from "@/lib/notify/whatsapp";
import { getSetting } from "@/lib/settings";

/** Sends a test message to check SMTP / WhatsApp configuration. */
export async function POST(req: Request) {
  const user = await apiAdmin();
  if (user instanceof NextResponse) return user;
  const parsed = z
    .object({ channel: z.enum(["email", "whatsapp"]), recipient: z.string().min(3).max(200) })
    .safeParse(await readJson(req));
  if (!parsed.success) return zodFail(parsed.error);
  const locale = await getLocale();
  const company = (await getSetting("company")).name || brandName();
  const tpl = DEFAULT_TEMPLATES.test[locale];
  const vars = { company, tracking_link: publicBaseUrl() };
  try {
    if (parsed.data.channel === "email") {
      await sendEmail({
        to: parsed.data.recipient,
        subject: renderTemplate(tpl.subject, vars),
        text: renderTemplate(tpl.body, vars),
        link: publicBaseUrl(),
        linkLabel: makeT(locale)("tracking.open_link"),
      });
    } else {
      const to = normalizePhone(parsed.data.recipient);
      if (!to) return NextResponse.json({ error: "invalid phone number" }, { status: 400 });
      await sendWhatsApp({
        to,
        kind: "test",
        locale,
        text: renderTemplate(tpl.body, vars),
        vars: { customer_name: company, eta: "—", tracking_link: publicBaseUrl() },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
