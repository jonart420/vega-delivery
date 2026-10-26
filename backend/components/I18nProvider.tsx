"use client";

import { createContext, useContext, useMemo } from "react";
import { intlLocale, makeT, type Locale, type TFunction } from "@/lib/i18n-core";

const Ctx = createContext<{ locale: Locale; t: TFunction } | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return { ...v, intl: intlLocale(v.locale) };
}
