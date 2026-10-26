"use client";

import { useState } from "react";
import { useI18n } from "@/components/I18nProvider";

export default function LoginForm({ brand, logo }: { brand: string; logo: string | null }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    // Full reload so server components pick up the new session and locale cookies
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.ok) window.location.href = "/";
    else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? t("common.error"));
  }

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt={brand} className="mb-2 h-10 w-auto" /> : <h1 className="text-xl font-semibold">{brand}</h1>}
          <p className="text-sm text-[var(--text-secondary)]">{t("login.subtitle")}</p>
        </div>
        <label className="field">
          <span>{t("login.username")}</span>
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("login.password")}</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? t("login.busy") : t("login.submit")}
        </button>
      </form>
    </main>
  );
}
