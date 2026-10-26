import { cookies, headers } from "next/headers";
import { defaultLocale, fromAcceptLanguage, isLocale, makeT, type Locale, type TFunction } from "./i18n-core";

export * from "./i18n-core";

export const LOCALE_COOKIE = "vd_locale";

/** Locale for the current request: cookie → Accept-Language → DEFAULT_LOCALE. */
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  return fromAcceptLanguage((await headers()).get("accept-language")) ?? defaultLocale();
}

export async function getT(): Promise<{ t: TFunction; locale: Locale }> {
  const locale = await getLocale();
  return { t: makeT(locale), locale };
}
