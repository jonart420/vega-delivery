"use client";

import { LOCALES, type Locale } from "@/lib/i18n-core";

export default function LocaleSwitch({ current }: { current: Locale }) {
  return (
    <select
      className="input !w-auto !py-1 text-xs"
      value={current}
      aria-label="Language"
      onChange={async (e) => {
        await fetch("/api/locale", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: e.target.value }),
        });
        window.location.reload();
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
