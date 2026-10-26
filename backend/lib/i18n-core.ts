import de from "@/messages/de.json";
import en from "@/messages/en.json";

/** Locale handling shared by server and client code (no Next.js imports here). */

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export type Messages = typeof en;

const DICTS: Record<Locale, Messages> = { en, de: de as Messages };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export function defaultLocale(): Locale {
  const v = (process.env.DEFAULT_LOCALE ?? "en").toLowerCase().slice(0, 2);
  return isLocale(v) ? v : "en";
}

export const messages = (locale: Locale): Messages => DICTS[locale];

/** Picks the best supported locale from an Accept-Language header. */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qp = params.find((p) => p.trim().startsWith("q="));
      return { lang: tag.toLowerCase().slice(0, 2), q: qp ? Number(qp.trim().slice(2)) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return ranked.find((r) => isLocale(r.lang))?.lang as Locale | undefined ?? null;
}

export type TFunction = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

/** Translator for a dictionary: dotted keys, {placeholders}; falls back to English, then the key. */
export function makeT(locale: Locale): TFunction {
  const dict = DICTS[locale];
  return (key, vars) => {
    const raw = lookup(dict, key) ?? lookup(DICTS.en, key) ?? key;
    return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? "" : String(vars[k]))) : raw;
  };
}

function lookup(dict: unknown, key: string): string | null {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else return null;
  }
  return typeof cur === "string" ? cur : null;
}

/** Label column for tables with label_en/label_de. */
export function label(row: { label_en: string; label_de: string }, locale: Locale): string {
  return locale === "de" ? row.label_de : row.label_en;
}

export const intlLocale = (l: Locale) => (l === "de" ? "de-DE" : "en-GB");
