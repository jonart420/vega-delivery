"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/components/I18nProvider";
import type { Role } from "@/lib/auth";
import type { TeamMember } from "@/lib/login-code";

type Run = (fn: () => Promise<{ error?: string; warning?: string }>, ok: string) => Promise<void>;

async function call(url: string, init?: RequestInit): Promise<{ error?: string; warning?: string }> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as { error?: string; warning?: string };
  if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
  return data;
}

export default function TeamClient({
  members,
  isAdmin,
  viewerId,
  configError,
}: {
  members: TeamMember[];
  isAdmin: boolean;
  viewerId: string;
  configError: string | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const run: Run = async (fn, ok) => {
    setMessage(null);
    const r = await fn();
    if (r.error) setMessage({ kind: "error", text: r.error });
    else setMessage({ kind: r.warning ? "error" : "ok", text: r.warning ?? ok });
    startTransition(() => router.refresh());
  };

  return (
    <div className="page">
      <div className="flex items-baseline justify-between">
        <h1 className="page-title">{t("team.title")}</h1>
        <span className="muted text-xs">{t("team.subtitle")}</span>
      </div>
      {configError && <div className="alert alert-error">{t("team.codes_unavailable")}: {configError}</div>}
      {message && <div className={`alert ${message.kind === "error" ? "alert-error" : "alert-ok"}`}>{message.text}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("team.username")}</th>
              <th>{t("team.login_code")}</th>
              <th>{t("team.preview")}</th>
              <th>{t("team.display_name")}</th>
              <th>{t("team.role")}</th>
              <th className="text-right">{t("team.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.id} m={m} isAdmin={isAdmin} isSelf={m.id === viewerId} busy={pending} run={run} />
            ))}
            {members.length === 0 && (
              <tr><td colSpan={6} className="muted">{t("team.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {isAdmin && <CreateForm busy={pending} run={run} />}
    </div>
  );
}

function MemberRow({ m, isAdmin, isSelf, busy, run }: { m: TeamMember; isAdmin: boolean; isSelf: boolean; busy: boolean; run: Run }) {
  const { t, intl } = useI18n();
  const c = m.code;
  const valid = c.status === "valid";
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(intl, { dateStyle: "short", timeStyle: "short" }) : "–");

  return (
    <tr className={m.active ? "" : "opacity-50"}>
      <td className="whitespace-nowrap font-medium">
        {m.username}
        <div className="muted text-xs">#{m.user_no}{m.active ? "" : ` · ${t("team.inactive")}`}</div>
      </td>
      <td className="min-w-[16rem]">
        {valid && (
          <div className="flex flex-col gap-1">
            <code className="font-mono text-sm tracking-wide">{c.grouped}</code>
            <div className="muted flex flex-wrap items-center gap-2 text-xs">
              <span className="chip chip-active">QR</span>
              <span>v{c.version}</span>
              <span>{t("team.created")} {fmt(c.created_at)}</span>
            </div>
          </div>
        )}
        {c.status === "none" && <span className="muted text-sm">{t("team.no_code")}</span>}
        {c.status === "hidden" && <span className="muted text-sm">{t("team.code_hidden")}</span>}
        {c.status === "revoked" && <span className="text-sm text-[var(--danger)]">{t("team.revoked_at", { date: fmt(c.revoked_at) })}</span>}
        {c.status === "invalid" && <span className="text-sm text-[var(--danger)]">{c.reason}</span>}
      </td>
      <td>
        {valid ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic PNG from the API, no-store
          <img src={`/api/team/${m.id}/code.png?size=256&v=${c.version}`} alt={m.username} width={72} height={72} className="rounded bg-white" />
        ) : (
          <span className="muted">–</span>
        )}
      </td>
      <td>{m.display_name || <span className="muted">–</span>}</td>
      <td>
        {isAdmin && !isSelf ? (
          <select
            className="input !w-auto !py-1 text-xs"
            value={m.role}
            disabled={busy}
            onChange={(e) => run(() => call(`/api/team/${m.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }), t("common.saved"))}
          >
            {(["driver", "dispatcher", "admin"] as Role[]).map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
          </select>
        ) : (
          <span className={`chip ${m.role === "admin" ? "chip-active" : ""}`}>{t(`roles.${m.role}`)}</span>
        )}
      </td>
      <td>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {valid && <a className="btn btn-sm" href={`/api/team/${m.id}/code.png`}>{t("team.download_png")}</a>}
          {isAdmin && (
            <>
              <button className="btn btn-sm" disabled={busy} onClick={() => {
                if (valid && !confirm(t("team.confirm_regenerate", { name: m.username }))) return;
                void run(() => call(`/api/team/${m.id}/code`, { method: "POST" }), t("team.code_generated", { name: m.username }));
              }}>
                {t("team.regenerate")}
              </button>
              {(valid || c.status === "invalid") && (
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => {
                  if (!confirm(t("team.confirm_revoke", { name: m.username }))) return;
                  void run(() => call(`/api/team/${m.id}/code`, { method: "DELETE" }), t("team.code_revoked", { name: m.username }));
                }}>
                  {t("team.revoke")}
                </button>
              )}
              {!isSelf && (
                <button className="btn btn-sm" disabled={busy} onClick={() =>
                  run(() => call(`/api/team/${m.id}`, { method: "PATCH", body: JSON.stringify({ active: !m.active }) }), t("common.saved"))}>
                  {m.active ? t("team.deactivate") : t("team.activate")}
                </button>
              )}
              {!isSelf && (
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => {
                  if (!confirm(t("team.confirm_delete", { name: m.username }))) return;
                  void run(() => call(`/api/team/${m.id}`, { method: "DELETE" }), t("team.deleted", { name: m.username }));
                }}>
                  {t("common.delete")}
                </button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function CreateForm({ busy, run }: { busy: boolean; run: Run }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("driver");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      className="card flex flex-col gap-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const name = username.trim();
        void run(async () => {
          const r = await call("/api/team", {
            method: "POST",
            body: JSON.stringify({ username: name, display_name: displayName.trim() || null, role, phone: phone || null, password: password || null }),
          });
          if (!r.error) {
            setUsername("");
            setDisplayName("");
            setPassword("");
            setPhone("");
            setRole("driver");
          }
          return r;
        }, t("team.created_member", { name }));
      }}
    >
      <h2 className="font-semibold">{t("team.create")}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="field">
          <span>{t("team.username")}</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
        </label>
        <label className="field">
          <span>{t("team.display_name")}</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="off" />
        </label>
        <label className="field">
          <span>{t("team.role")}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(["driver", "dispatcher", "admin"] as Role[]).map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("customers.phone")}</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("team.password")}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={12} />
        </label>
      </div>
      <p className="muted text-xs">{t("team.create_hint")}</p>
      <div>
        <button className="btn-primary" disabled={busy || !username.trim()}>{t("team.create_button")}</button>
      </div>
    </form>
  );
}
