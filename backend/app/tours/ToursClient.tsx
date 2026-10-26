"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import TourStatusBadge from "@/components/TourStatusBadge";
import type { Tour } from "@/lib/tours";

export default function ToursClient({ tours, drivers }: { tours: Tour[]; drivers: { id: string; name: string }[] }) {
  const { t, intl } = useI18n();
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState("");
  const [driver, setDriver] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"upcoming" | "past" | "all">("upcoming");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ tour: { id: string } }>("/api/tours", "POST", {
        date,
        title: title.trim() || `${t("tours.default_title")} ${new Date(`${date}T12:00:00Z`).toLocaleDateString(intl)}`,
        driver_id: driver || null,
      });
      router.push(`/tours/${r.tour.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const visible = tours.filter((tour) =>
    filter === "all" ? true : filter === "upcoming" ? tour.date >= today || tour.status === "in_progress" : tour.date < today,
  );

  return (
    <main className="page">
      <h1 className="page-title">{t("tours.title")}</h1>
      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
        <label className="field">
          <span>{t("tours.date")}</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field min-w-56 flex-1">
          <span>{t("tours.name")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("tours.name_hint")} />
        </label>
        <label className="field">
          <span>{t("tours.driver")}</span>
          <select value={driver} onChange={(e) => setDriver(e.target.value)}>
            <option value="">—</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <button className="btn-primary">{t("tours.create")}</button>
      </form>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="flex gap-2">
        {(["upcoming", "past", "all"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "chip-active" : ""}`} onClick={() => setFilter(f)}>{t(`tours.filter_${f}`)}</button>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("tours.date")}</th>
              <th>{t("tours.name")}</th>
              <th>{t("tours.driver")}</th>
              <th>{t("tours.status")}</th>
              <th className="text-right">{t("tours.stops")}</th>
              <th className="text-right">{t("tours.distance")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((tour) => (
              <tr key={tour.id}>
                <td className="whitespace-nowrap text-sm">{new Date(`${tour.date}T12:00:00Z`).toLocaleDateString(intl, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                <td><Link href={`/tours/${tour.id}`} className="font-medium hover:underline">{tour.title}</Link></td>
                <td className="text-sm">{tour.driver_name ?? <span className="muted">{t("tours.no_driver")}</span>}</td>
                <td><TourStatusBadge status={tour.status} /></td>
                <td className="text-right tabular-nums">
                  {tour.status === "draft" || tour.status === "released" ? tour.stop_count : `${tour.done_count + tour.failed_count}/${tour.stop_count}`}
                </td>
                <td className="text-right tabular-nums">{tour.route ? `${tour.route.distance_km.toFixed(1)} km` : "—"}</td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={6} className="muted py-8 text-center">{t("tours.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
