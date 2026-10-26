"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, euro } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import { OrderStatusBadge } from "@/components/TourStatusBadge";
import { ORDER_STATUSES } from "@/lib/order-status";
import type { OrderRow } from "@/lib/orders";

const name = (o: OrderRow) => [[o.first_name, o.last_name].filter(Boolean).join(" "), o.company].filter(Boolean).join(" - ");

export default function OrderList({
  orders,
  filters,
  tours,
}: {
  orders: OrderRow[];
  filters: { date: string; status: string; q: string };
  tours: { id: string; title: string; date: string }[];
}) {
  const { t, intl } = useI18n();
  const router = useRouter();
  const [f, setF] = useState(filters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetTour, setTargetTour] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = (next = f) => {
    const p = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    router.push(`/orders${p.size ? `?${p}` : ""}`);
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const plannable = orders.filter((o) => selected.has(o.id) && o.status === "open" && !o.tour_id);

  async function addToTour() {
    setError(null);
    try {
      if (targetTour === "new") {
        const date = plannable[0]?.delivery_date ?? new Date().toISOString().slice(0, 10);
        const r = await api<{ tour: { id: string } }>("/api/tours", "POST", {
          date,
          title: `${t("tours.default_title")} ${new Date(`${date}T12:00:00Z`).toLocaleDateString(intl)}`,
          order_ids: plannable.map((o) => o.id),
        });
        router.push(`/tours/${r.tour.id}`);
      } else if (targetTour) {
        await api(`/api/tours/${targetTour}/orders`, "POST", { order_ids: plannable.map((o) => o.id) });
        router.push(`/tours/${targetTour}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{t("orders.title")}</h1>
        <Link className="btn-primary" href="/orders/new">{t("orders.new")}</Link>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="field">
          <span>{t("orders.delivery_date")}</span>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label className="field">
          <span>{t("orders.status")}</span>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">{t("common.all")}</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`order_status.${s}`)}</option>)}
          </select>
        </label>
        <label className="field min-w-56 flex-1">
          <span>{t("common.search")}</span>
          <input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={t("orders.search")} />
        </label>
        <button className="btn">{t("common.filter")}</button>
        {(f.date || f.status || f.q) && (
          <button type="button" className="btn" onClick={() => { const e = { date: "", status: "", q: "" }; setF(e); apply(e); }}>
            {t("common.reset")}
          </button>
        )}
      </form>

      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-3 p-3 text-sm">
          <span>{t("orders.selected", { n: selected.size })}</span>
          <a className="btn btn-sm" href={`/api/orders/labels?ids=${[...selected].join(",")}`} target="_blank">{t("orders.print_labels")}</a>
          {plannable.length > 0 && (
            <>
              <select className="input !w-auto !py-1" value={targetTour} onChange={(e) => setTargetTour(e.target.value)}>
                <option value="">{t("orders.choose_tour", { n: plannable.length })}</option>
                <option value="new">{t("orders.new_tour")}</option>
                {tours.map((tour) => (
                  <option key={tour.id} value={tour.id}>
                    {tour.title} ({new Date(`${tour.date}T12:00:00Z`).toLocaleDateString(intl)})
                  </option>
                ))}
              </select>
              <button className="btn-primary btn-sm" disabled={!targetTour} onClick={addToTour}>{t("orders.plan")}</button>
            </>
          )}
          <button className="btn btn-sm ml-auto" onClick={() => setSelected(new Set())}>{t("common.clear_selection")}</button>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8">
                <input
                  type="checkbox"
                  checked={orders.length > 0 && selected.size === orders.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(orders.map((o) => o.id)) : new Set())}
                />
              </th>
              <th>{t("orders.no")}</th>
              <th>{t("orders.delivery_date")}</th>
              <th>{t("orders.customer")}</th>
              <th>{t("customers.address")}</th>
              <th>{t("orders.status")}</th>
              <th>{t("orders.tour")}</th>
              <th className="text-right">{t("orders.total")}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>
                <td><Link href={`/orders/${o.id}`} className="font-mono text-xs hover:underline">{o.order_no}</Link></td>
                <td className="whitespace-nowrap text-sm">
                  {new Date(`${o.delivery_date}T12:00:00Z`).toLocaleDateString(intl)}
                  {o.time_window_from && <span className="muted ml-1 text-xs">{o.time_window_from}–{o.time_window_to ?? ""}</span>}
                </td>
                <td className="text-sm font-medium">{name(o)}</td>
                <td className="muted text-sm">
                  {o.zip} {o.city}
                  {o.lat == null && <span className="badge badge-danger ml-2">{t("customers.no_coords")}</span>}
                </td>
                <td><OrderStatusBadge status={o.status} /></td>
                <td className="text-sm">{o.tour_id ? <Link href={`/tours/${o.tour_id}`} className="hover:underline">{o.tour_title}</Link> : "—"}</td>
                <td className="text-right text-sm tabular-nums">{euro(o.total_cents, intl)}</td>
              </tr>
            ))}
            {!orders.length && <tr><td colSpan={8} className="muted py-8 text-center">{t("orders.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
