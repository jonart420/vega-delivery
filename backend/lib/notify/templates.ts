import type { Locale } from "../i18n-core";

/**
 * Default message templates per kind and language. Overridable under Settings → Notifications
 * (stored as settings.templates["<kind>.<locale>"]). Placeholders: {{customer_name}}, {{company}},
 * {{eta}}, {{eta_window}}, {{date}}, {{tracking_link}}, {{stops_ahead}}, {{order_numbers}}, {{driver_name}}.
 */

export type NotifyKind = "day_start" | "approaching" | "manual" | "delivered" | "failed" | "test";
export const NOTIFY_KINDS: NotifyKind[] = ["day_start", "approaching", "manual", "delivered", "failed"];

export type Template = { subject: string; body: string };

export const DEFAULT_TEMPLATES: Record<NotifyKind, Record<Locale, Template>> = {
  day_start: {
    en: {
      subject: "Your delivery from {{company}} arrives today",
      body: "Hello {{customer_name}},\n\nyour delivery is planned for today, {{date}}, expected between {{eta_window}}.\nWe will send you a live tracking link shortly before we arrive:\n{{tracking_link}}\n\nKind regards\n{{company}}",
    },
    de: {
      subject: "Ihre Lieferung von {{company}} kommt heute",
      body: "Hallo {{customer_name}},\n\nIhre Lieferung ist für heute, {{date}}, geplant – voraussichtlich zwischen {{eta_window}} Uhr.\nKurz bevor wir bei Ihnen sind, wird die Live-Verfolgung freigeschaltet:\n{{tracking_link}}\n\nViele Grüße\n{{company}}",
    },
  },
  approaching: {
    en: {
      subject: "We are almost there – track your delivery live",
      body: "Hello {{customer_name}},\n\nour driver is on the way to you ({{stops_ahead}} stops ahead), expected around {{eta}}.\nFollow the delivery live:\n{{tracking_link}}\n\nKind regards\n{{company}}",
    },
    de: {
      subject: "Gleich sind wir da – Lieferung live verfolgen",
      body: "Hallo {{customer_name}},\n\nunser Fahrer ist auf dem Weg zu Ihnen (noch {{stops_ahead}} Stopps), voraussichtlich gegen {{eta}} Uhr.\nHier können Sie die Lieferung live verfolgen:\n{{tracking_link}}\n\nViele Grüße\n{{company}}",
    },
  },
  manual: {
    en: {
      subject: "Update on your delivery",
      body: "Hello {{customer_name}},\n\nhere is the current status of your delivery (expected around {{eta}}):\n{{tracking_link}}\n\nKind regards\n{{company}}",
    },
    de: {
      subject: "Neuigkeiten zu Ihrer Lieferung",
      body: "Hallo {{customer_name}},\n\nhier ist der aktuelle Stand Ihrer Lieferung (voraussichtlich gegen {{eta}} Uhr):\n{{tracking_link}}\n\nViele Grüße\n{{company}}",
    },
  },
  delivered: {
    en: {
      subject: "Your delivery has arrived",
      body: "Hello {{customer_name}},\n\nyour delivery ({{order_numbers}}) was delivered. Details:\n{{tracking_link}}\n\nThank you!\n{{company}}",
    },
    de: {
      subject: "Ihre Lieferung ist angekommen",
      body: "Hallo {{customer_name}},\n\nIhre Lieferung ({{order_numbers}}) wurde zugestellt. Details:\n{{tracking_link}}\n\nVielen Dank!\n{{company}}",
    },
  },
  failed: {
    en: {
      subject: "We could not deliver today",
      body: "Hello {{customer_name}},\n\nunfortunately we could not deliver your order ({{order_numbers}}) today. We will contact you to arrange a new date.\n{{tracking_link}}\n\nKind regards\n{{company}}",
    },
    de: {
      subject: "Zustellung heute leider nicht möglich",
      body: "Hallo {{customer_name}},\n\nleider konnten wir Ihre Bestellung ({{order_numbers}}) heute nicht zustellen. Wir melden uns für einen neuen Termin.\n{{tracking_link}}\n\nViele Grüße\n{{company}}",
    },
  },
  test: {
    en: { subject: "Test message from {{company}}", body: "This is a test message.\n{{tracking_link}}" },
    de: { subject: "Testnachricht von {{company}}", body: "Dies ist eine Testnachricht.\n{{tracking_link}}" },
  },
};

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
}
