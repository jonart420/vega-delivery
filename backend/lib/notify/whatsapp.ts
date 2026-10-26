/**
 * WhatsApp via pluggable providers (WHATSAPP_PROVIDER = none | log | meta | twilio).
 *
 * Business-initiated WhatsApp messages need a pre-approved template at the provider. Templates
 * receive three body variables in this order: 1 = customer name, 2 = ETA text, 3 = tracking link.
 *  - meta:   WhatsApp Cloud API. WHATSAPP_META_TOKEN, WHATSAPP_META_PHONE_NUMBER_ID,
 *            template name per kind WHATSAPP_META_TEMPLATE_<KIND> (e.g. _APPROACHING), language from the customer.
 *  - twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (+E.164),
 *            content template per kind TWILIO_CONTENT_SID_<KIND>; without one the plain text is sent
 *            (only works inside the 24 h customer service window).
 *  - log:    prints the message to the server log (development).
 */

import type { NotifyKind } from "./templates";

export type WhatsAppMessage = {
  to: string; // E.164
  kind: NotifyKind;
  locale: string;
  text: string;
  vars: { customer_name: string; eta: string; tracking_link: string };
};

export const whatsappProvider = () => (process.env.WHATSAPP_PROVIDER || "none").toLowerCase();
export const whatsappEnabled = () => ["log", "meta", "twilio"].includes(whatsappProvider());

export async function sendWhatsApp(msg: WhatsAppMessage): Promise<{ id: string; provider: string }> {
  const provider = whatsappProvider();
  switch (provider) {
    case "log":
      console.log(`[whatsapp:log] → ${msg.to} (${msg.kind}/${msg.locale})\n${msg.text}`);
      return { id: `log-${Date.now()}`, provider };
    case "meta":
      return { id: await sendMeta(msg), provider };
    case "twilio":
      return { id: await sendTwilio(msg), provider };
    default:
      throw new Error("WhatsApp is disabled (WHATSAPP_PROVIDER=none)");
  }
}

async function sendMeta(msg: WhatsAppMessage): Promise<string> {
  const token = process.env.WHATSAPP_META_TOKEN;
  const phoneId = process.env.WHATSAPP_META_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_META_API_VERSION || "v21.0";
  const template = process.env[`WHATSAPP_META_TEMPLATE_${msg.kind.toUpperCase()}`];
  if (!token || !phoneId) throw new Error("WhatsApp Meta: token or phone number id missing");
  const body = template
    ? {
        messaging_product: "whatsapp",
        to: msg.to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: template,
          language: { code: msg.locale === "de" ? "de" : "en" },
          components: [
            {
              type: "body",
              parameters: [msg.vars.customer_name, msg.vars.eta, msg.vars.tracking_link].map((text) => ({ type: "text", text })),
            },
          ],
        },
      }
    : { messaging_product: "whatsapp", to: msg.to.replace(/^\+/, ""), type: "text", text: { body: msg.text, preview_url: true } };
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`WhatsApp Meta: ${json.error?.message ?? res.status}`);
  return json.messages?.[0]?.id ?? "";
}

async function sendTwilio(msg: WhatsAppMessage): Promise<string> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !token || !from) throw new Error("Twilio: account sid, auth token or sender missing");
  const contentSid = process.env[`TWILIO_CONTENT_SID_${msg.kind.toUpperCase()}`];
  const form = new URLSearchParams({ From: `whatsapp:${from}`, To: `whatsapp:${msg.to}` });
  if (contentSid) {
    form.set("ContentSid", contentSid);
    form.set("ContentVariables", JSON.stringify({ "1": msg.vars.customer_name, "2": msg.vars.eta, "3": msg.vars.tracking_link }));
  } else form.set("Body", msg.text);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio: ${json.message ?? res.status}`);
  return json.sid ?? "";
}
