"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import type { Customer } from "@/lib/customers";

const name = (c: Customer) => [[c.first_name, c.last_name].filter(Boolean).join(" "), c.company].filter(Boolean).join(" - ");

export default function CustomerList({ initial }: { initial: Customer[] }) {
  const { t } = useI18n();
  const [rows, setRows] = useState(initial);
  const [search, setSearch] = useState("");
  const [inactive, setInactive] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      const p = new URLSearchParams({ q: search, inactive: inactive ? "1" : "0" });
      const r = await api<{ customers: Customer[] }>(`/api/customers?${p}`);
      setRows(r.customers);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, inactive]);

  async function importCsv(file: File) {
    setMessage(null);
    const res = await fetch("/api/customers/import", { method: "POST", body: await file.text() });
    const r = (await res.json()) as { created?: number; errors?: { row: number; error: string }[]; total?: number; error?: string };
    if (!res.ok) return setMessage({ ok: false, text: r.error ?? t("common.error") });
    setMessage({
      ok: !r.errors?.length,
      text: t("customers.import_result", { created: r.created ?? 0, total: r.total ?? 0 }) +
        (r.errors?.length ? " · " + r.errors.slice(0, 5).map((e) => `${t("customers.row")} ${e.row}: ${e.error}`).join(" · ") : ""),
    });
    const list = await api<{ customers: Customer[] }>(`/api/customers?q=${encodeURIComponent(search)}`);
    setRows(list.customers);
  }

  return (
    <main className="page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{t("customers.title")}</h1>
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <button className="btn" onClick={() => fileRef.current?.click()}>{t("customers.import")}</button>
          <a className="btn" href="/api/customers/export" download>{t("customers.export")}</a>
          {rows.length > 0 && (
            <a className="btn" target="_blank" href={`/api/customers/sheets?ids=${rows.slice(0, 1000).map((c) => c.id).join(",")}`}>
              {t("customers.print_sheets", { n: Math.min(rows.length, 1000) })}
            </a>
          )}
          <Link className="btn-primary" href="/customers/new">{t("customers.new")}</Link>
        </div>
      </div>
      {message && <div className={`alert ${message.ok ? "alert-ok" : "alert-error"}`}>{message.text}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <input className="input max-w-md" type="search" placeholder={t("customers.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check text-sm">
          <input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
          {t("customers.show_inactive")}
        </label>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("customers.no")}</th>
              <th>{t("customers.name")}</th>
              <th>{t("customers.address")}</th>
              <th>{t("customers.contact")}</th>
              <th>{t("customers.notifications")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.active ? "" : "opacity-50"}>
                <td className="font-mono text-xs">{c.customer_no}</td>
                <td>
                  <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{name(c) || "—"}</Link>
                </td>
                <td className="text-sm">
                  {[c.street, c.house_no].filter(Boolean).join(" ")}, {c.zip} {c.city}
                  {c.geocode_status === "failed" && <span className="badge badge-danger ml-2">{t("customers.no_coords")}</span>}
                </td>
                <td className="muted text-sm">{c.phone || c.email || "—"}</td>
                <td className="space-x-1">
                  {c.notify_email && <span className="chip">{t("channels.email")}</span>}
                  {c.notify_whatsapp && <span className="chip">{t("channels.whatsapp")}</span>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="muted py-8 text-center">{t("customers.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
