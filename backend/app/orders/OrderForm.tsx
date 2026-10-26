"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, euro } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import { OrderStatusBadge } from "@/components/TourStatusBadge";
import type { Customer } from "@/lib/customers";
import type { OrderDetail } from "@/lib/orders";
import type { Product } from "@/lib/products";

type Item = { product_id: string | null; name: string; qty: string; unit: string; price: string };

const customerLabel = (c: Customer) =>
  `${[[c.first_name, c.last_name].filter(Boolean).join(" "), c.company].filter(Boolean).join(" - ")} · ${c.zip} ${c.city} (#${c.customer_no})`;

function tomorrow() {
  const d = new Date(Date.now() + 864e5);
  return d.toISOString().slice(0, 10);
}

export default function OrderForm({
  order,
  products,
  initialCustomer,
}: {
  order: OrderDetail | null;
  products: Product[];
  initialCustomer: Customer | null;
}) {
  const { t, intl } = useI18n();
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerHits, setCustomerHits] = useState<Customer[]>([]);
  const [date, setDate] = useState(order?.delivery_date ?? tomorrow());
  const [from, setFrom] = useState(order?.time_window_from ?? "");
  const [to, setTo] = useState(order?.time_window_to ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [items, setItems] = useState<Item[]>(
    order?.items.map((i) => ({
      product_id: i.product_id,
      name: i.name_snapshot,
      qty: String(Number(i.qty)),
      unit: i.unit,
      price: (i.unit_price_cents / 100).toFixed(2),
    })) ?? [],
  );
  const [productPick, setProductPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = !order || ["open", "planned"].includes(order.status);

  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      const r = await api<{ customers: Customer[] }>(`/api/customers?q=${encodeURIComponent(q)}&limit=10`);
      setCustomerHits(r.customers);
    }, 200);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  const total = items.reduce((s, i) => s + Math.round(Number(i.qty.replace(",", ".") || 0) * Number(i.price.replace(",", ".") || 0) * 100), 0);

  function addProduct(id: string) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setItems((list) => [...list, { product_id: p.id, name: p.name, qty: "1", unit: p.unit, price: (p.price_cents / 100).toFixed(2) }]);
    setProductPick("");
  }

  async function save() {
    if (!customer) return setMessage({ ok: false, text: t("orders.customer_required") });
    setBusy(true);
    setMessage(null);
    const body = {
      customer_id: customer.id,
      delivery_date: date,
      time_window_from: from || null,
      time_window_to: to || null,
      notes: notes || null,
      items: items
        .filter((i) => i.name.trim() && Number(i.qty.replace(",", ".")) > 0)
        .map((i) => ({
          product_id: i.product_id,
          name: i.name,
          qty: Number(i.qty.replace(",", ".")),
          unit: i.unit,
          unit_price_cents: Math.round(Number(i.price.replace(",", ".") || 0) * 100),
        })),
    };
    try {
      const r = order
        ? await api<{ order: OrderDetail }>(`/api/orders/${order.id}`, "PUT", body)
        : await api<{ order: OrderDetail }>("/api/orders", "POST", body);
      if (!order) router.push(`/orders/${r.order.id}`);
      else {
        setMessage({ ok: true, text: t("common.saved") });
        router.refresh();
      }
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function action(a: "cancel" | "reopen" | "reschedule") {
    if (!order) return;
    let delivery_date: string | undefined;
    if (a === "reschedule") {
      const d = prompt(t("orders.new_date"), tomorrow());
      if (!d) return;
      delivery_date = d;
    } else if (a === "cancel" && !confirm(t("orders.confirm_cancel"))) return;
    try {
      await api(`/api/orders/${order.id}`, "PATCH", { action: a, delivery_date });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  }

  async function remove() {
    if (!order || !confirm(t("orders.confirm_delete"))) return;
    try {
      await api(`/api/orders/${order.id}`, "DELETE");
      router.push("/orders");
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <main className="page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/orders" className="muted text-sm hover:underline">← {t("orders.title")}</Link>
          <h1 className="page-title flex items-center gap-3">
            {order ? `${t("orders.order")} ${order.order_no}` : t("orders.new")}
            {order && <OrderStatusBadge status={order.status} />}
          </h1>
        </div>
        {order && (
          <div className="flex flex-wrap gap-2">
            <a className="btn" href={`/api/orders/labels?ids=${order.id}`} target="_blank">{t("orders.print_label")}</a>
            {["failed", "open", "cancelled"].includes(order.status) && <button className="btn" onClick={() => action("reschedule")}>{t("orders.reschedule")}</button>}
            {order.status === "cancelled" && <button className="btn" onClick={() => action("reopen")}>{t("orders.reopen")}</button>}
            {["open", "planned", "failed"].includes(order.status) && <button className="btn" onClick={() => action("cancel")}>{t("orders.cancel")}</button>}
            {["open", "cancelled"].includes(order.status) && !order.tour_id && <button className="btn btn-danger" onClick={remove}>{t("common.delete")}</button>}
          </div>
        )}
      </div>
      {message && <div className={`alert ${message.ok ? "alert-ok" : "alert-error"}`}>{message.text}</div>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="card space-y-3 p-4">
            <h2 className="font-medium">{t("orders.customer")}</h2>
            {customer ? (
              <div className="flex items-center justify-between gap-2">
                <Link href={`/customers/${customer.id}`} className="hover:underline">{customerLabel(customer)}</Link>
                {editable && <button className="btn btn-sm" onClick={() => setCustomer(null)}>{t("common.change")}</button>}
              </div>
            ) : (
              <div className="relative">
                <input className="input" autoFocus placeholder={t("orders.customer_search")} value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
                {customerQuery.trim().length >= 2 && (
                  <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg">
                    {customerHits.map((c) => (
                      <li key={c.id}>
                        <button className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--bg-hover)]" onClick={() => { setCustomer(c); setCustomerQuery(""); }}>
                          {customerLabel(c)}
                        </button>
                      </li>
                    ))}
                    {!customerHits.length && <li className="muted px-3 py-2 text-sm">{t("search.nothing")} · <Link className="underline" href="/customers/new">{t("customers.new")}</Link></li>}
                  </ul>
                )}
              </div>
            )}
            {customer?.delivery_notes && <p className="muted text-sm">{t("customers.delivery_notes")}: {customer.delivery_notes}</p>}
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="font-medium">{t("orders.items")}</h2>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("products.name")}</th>
                    <th className="w-24">{t("orders.qty")}</th>
                    <th className="w-24">{t("products.unit")}</th>
                    <th className="w-28">{t("products.price")}</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td><input className="input" disabled={!editable} value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                      <td><input className="input" disabled={!editable} inputMode="decimal" value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                      <td className="text-sm">{t(`units.${it.unit}`)}</td>
                      <td><input className="input" disabled={!editable} inputMode="decimal" value={it.price} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} /></td>
                      <td>{editable && <button className="btn btn-sm btn-danger" onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>}</td>
                    </tr>
                  ))}
                  {!items.length && <tr><td colSpan={5} className="muted py-4 text-center text-sm">{t("orders.no_items")}</td></tr>}
                </tbody>
              </table>
            </div>
            {editable && (
              <div className="flex flex-wrap gap-2">
                <select className="input max-w-sm" value={productPick} onChange={(e) => addProduct(e.target.value)}>
                  <option value="">{t("orders.add_product")}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>)}
                </select>
                <button className="btn" onClick={() => setItems([...items, { product_id: null, name: "", qty: "1", unit: "pcs", price: "0.00" }])}>
                  {t("orders.add_free_item")}
                </button>
              </div>
            )}
            <div className="text-right font-medium">{t("orders.total")}: {euro(total, intl)}</div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card space-y-3 p-4">
            <label className="field">
              <span>{t("orders.delivery_date")}</span>
              <input type="date" disabled={!editable} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="field">
                <span>{t("customers.window_from")}</span>
                <input type="time" disabled={!editable} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="field">
                <span>{t("customers.window_to")}</span>
                <input type="time" disabled={!editable} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>{t("orders.notes")}</span>
              <textarea rows={3} disabled={!editable} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            {editable && <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy ? t("common.saving") : t("common.save")}</button>}
          </section>
          {order && (
            <section className="card space-y-2 p-4">
              <h2 className="font-medium">{t("orders.delivery_code")}</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/barcodes/ean13/${order.delivery_ean13}?format=svg`} alt={order.delivery_ean13} className="mx-auto max-h-28 bg-white p-2" />
              {order.tour_id && (
                <p className="text-sm">{t("orders.tour")}: <Link href={`/tours/${order.tour_id}`} className="hover:underline">{order.tour_title}</Link></p>
              )}
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
