"use client";

import type { Marker } from "maplibre-gl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import PlaceSearch from "@/components/PlaceSearch";
import { OrderStatusBadge } from "@/components/TourStatusBadge";
import { fitTo, useMap } from "@/components/useMap";
import type { Customer } from "@/lib/customers";
import type { DeliveryEvent } from "@/lib/deliveries";
import type { GeocodeResult } from "@/lib/geocode";
import { maplibregl } from "@/lib/maplibre";
import type { OrderRow } from "@/lib/orders";

type Form = Record<string, string | boolean | number | null>;

const EMPTY: Form = {
  company: "", first_name: "", last_name: "", street: "", house_no: "", address_extra: "", zip: "", city: "", country: "DE",
  phone: "", email: "", whatsapp: "", notify_email: false, notify_whatsapp: false, locale: "", delivery_notes: "",
  time_window_from: "", time_window_to: "", dwell_minutes: "", barcode_mode: "", fixed_delivery_ean: "", notes: "", active: true,
  lat: null, lon: null,
};

function toForm(c: Customer | null): Form {
  if (!c) return { ...EMPTY };
  const f: Form = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) {
    const v = (c as unknown as Record<string, unknown>)[k];
    f[k] = v == null ? (typeof EMPTY[k] === "boolean" ? false : k === "lat" || k === "lon" ? null : "") : (v as string | boolean | number);
  }
  return f;
}

export default function CustomerForm({
  customer,
  mapStyle,
  orders,
  events,
}: {
  customer: Customer | null;
  mapStyle: string;
  orders: OrderRow[];
  events: DeliveryEvent[];
}) {
  const { t, locale, intl } = useI18n();
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => toForm(customer));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinMoved, setPinMoved] = useState(false);
  const { containerRef, mapRef, ready } = useMap(mapStyle, {
    center: customer?.lon != null && customer.lat != null ? [customer.lon, customer.lat] : undefined,
    zoom: customer?.lat != null ? 16 : 11,
  });
  const markerRef = useRef<Marker | null>(null);

  const set = (k: string, v: string | boolean | number | null) => setForm((f) => ({ ...f, [k]: v }));

  const placeMarker = useCallback(
    (lon: number, lat: number, fly = true) => {
      const map = mapRef.current;
      if (!map) return;
      if (!markerRef.current) {
        const el = document.createElement("div");
        el.className = "vd-home";
        el.textContent = "⌂";
        markerRef.current = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]).addTo(map);
        markerRef.current.on("dragend", () => {
          const p = markerRef.current!.getLngLat();
          setForm((f) => ({ ...f, lat: p.lat, lon: p.lng }));
          setPinMoved(true);
        });
      } else markerRef.current.setLngLat([lon, lat]);
      if (fly) fitTo(map, [[lon, lat]]);
    },
    [mapRef],
  );

  useEffect(() => {
    if (ready && customer?.lat != null && customer.lon != null) placeMarker(customer.lon, customer.lat, false);
  }, [ready, customer, placeMarker]);

  function pickAddress(r: GeocodeResult) {
    setForm((f) => ({
      ...f,
      street: r.street ?? f.street,
      house_no: r.house_no ?? f.house_no,
      zip: r.zip ?? f.zip,
      city: r.city ?? f.city,
      country: r.country ?? f.country,
      lat: r.lat,
      lon: r.lon,
    }));
    setPinMoved(true);
    placeMarker(r.lon, r.lat);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) body[k] = v === "" ? null : v;
    body.dwell_minutes = form.dwell_minutes === "" || form.dwell_minutes == null ? null : Number(form.dwell_minutes);
    body.country = form.country || "DE";
    // Only send coordinates when set by search/pin; otherwise the backend geocodes the address
    if (!pinMoved && customer?.geocode_status !== "manual") {
      body.lat = null;
      body.lon = null;
    }
    try {
      const r = customer
        ? await api<{ customer: Customer }>(`/api/customers/${customer.id}`, "PUT", body)
        : await api<{ customer: Customer }>("/api/customers", "POST", body);
      if (!customer) {
        router.push(`/customers/${r.customer.id}`);
        return;
      }
      setForm(toForm(r.customer));
      setPinMoved(false);
      if (r.customer.lat != null && r.customer.lon != null) placeMarker(r.customer.lon, r.customer.lat);
      setMessage({
        ok: r.customer.geocode_status !== "failed",
        text: r.customer.geocode_status === "failed" ? t("customers.geocode_failed") : t("common.saved"),
      });
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!customer || !confirm(t("customers.confirm_delete"))) return;
    await api(`/api/customers/${customer.id}`, "DELETE");
    router.push("/customers");
  }

  const text = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} {...props} />
    </label>
  );

  return (
    <main className="page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/customers" className="muted text-sm hover:underline">← {t("customers.title")}</Link>
          <h1 className="page-title">
            {customer ? (
              <>
                {[[customer.first_name, customer.last_name].filter(Boolean).join(" "), customer.company].filter(Boolean).join(" - ")}
                <span className="muted ml-2 font-mono text-sm">#{customer.customer_no}</span>
              </>
            ) : (
              t("customers.new")
            )}
          </h1>
        </div>
        {customer && (
          <div className="flex gap-2">
            <Link className="btn" href={`/orders/new?customer=${customer.id}`}>{t("orders.new")}</Link>
            <button className="btn btn-danger" onClick={remove}>{customer.active ? t("common.delete") : t("common.delete")}</button>
          </div>
        )}
      </div>
      {message && <div className={`alert ${message.ok ? "alert-ok" : "alert-error"}`}>{message.text}</div>}

      <form onSubmit={save} className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <section className="card space-y-3 p-4">
            <h2 className="font-medium">{t("customers.section_name")}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {text("first_name", t("customers.first_name"), { autoComplete: "off" })}
              {text("last_name", t("customers.last_name"), { autoComplete: "off" })}
              {text("company", t("customers.company"), { autoComplete: "off" })}
            </div>
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="font-medium">{t("customers.section_address")}</h2>
            <PlaceSearch onPick={pickAddress} getCenter={() => null} placeholder={t("customers.address_search")} />
            <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
              {text("street", t("customers.street"), { required: true })}
              {text("house_no", t("customers.house_no"))}
            </div>
            {text("address_extra", t("customers.address_extra"))}
            <div className="grid gap-3 sm:grid-cols-[120px_1fr_90px]">
              {text("zip", t("customers.zip"), { required: true })}
              {text("city", t("customers.city"), { required: true })}
              {text("country", t("customers.country"), { maxLength: 2 })}
            </div>
            <label className="field">
              <span>{t("customers.delivery_notes")}</span>
              <textarea rows={2} value={String(form.delivery_notes ?? "")} onChange={(e) => set("delivery_notes", e.target.value)} placeholder={t("customers.delivery_notes_hint")} />
            </label>
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="font-medium">{t("customers.section_contact")}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {text("phone", t("customers.phone"), { type: "tel" })}
              {text("email", t("customers.email"), { type: "email" })}
              {text("whatsapp", t("customers.whatsapp"), { type: "tel", placeholder: "+49…" })}
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="check">
                <input type="checkbox" checked={!!form.notify_email} onChange={(e) => set("notify_email", e.target.checked)} />
                {t("customers.notify_email")}
              </label>
              <label className="check">
                <input type="checkbox" checked={!!form.notify_whatsapp} onChange={(e) => set("notify_whatsapp", e.target.checked)} />
                {t("customers.notify_whatsapp")}
              </label>
              <label className="field !flex-row items-center gap-2">
                <span>{t("customers.locale")}</span>
                <select className="!w-auto" value={String(form.locale ?? "")} onChange={(e) => set("locale", e.target.value)}>
                  <option value="">{t("common.default")}</option>
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <p className="muted text-xs">{t("customers.consent_hint")}</p>
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="font-medium">{t("customers.section_delivery")}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {text("time_window_from", t("customers.window_from"), { type: "time" })}
              {text("time_window_to", t("customers.window_to"), { type: "time" })}
              {text("dwell_minutes", t("customers.dwell"), { type: "number", min: 0, max: 240 })}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field">
                <span>{t("customers.barcode_mode")}</span>
                <select value={String(form.barcode_mode ?? "")} onChange={(e) => set("barcode_mode", e.target.value)}>
                  <option value="">{t("customers.barcode_mode_global")}</option>
                  <option value="per_customer">{t("settings.barcode_per_customer")}</option>
                  <option value="per_delivery">{t("settings.barcode_per_delivery")}</option>
                </select>
              </label>
              {form.barcode_mode === "per_customer" &&
                text("fixed_delivery_ean", t("customers.fixed_ean"), { inputMode: "numeric", maxLength: 13, placeholder: t("customers.fixed_ean_hint") })}
            </div>
            <label className="field">
              <span>{t("customers.notes")}</span>
              <textarea rows={2} value={String(form.notes ?? "")} onChange={(e) => set("notes", e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={!!form.active} onChange={(e) => set("active", e.target.checked)} />
              {t("customers.active")}
            </label>
          </section>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={saving}>{saving ? t("common.saving") : t("common.save")}</button>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card overflow-hidden">
            <div ref={containerRef} className="h-72 w-full" />
            <p className="muted px-3 py-2 text-xs">
              {form.lat != null ? t("customers.pin_hint") : t("customers.pin_missing")}
            </p>
          </div>
          {customer && (
            <div className="card space-y-2 p-4">
              <h2 className="font-medium">{t("customers.indicator")}</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/customers/${customer.id}/indicator?format=svg&v=${customer.updated_at}`} alt={customer.customer_no} className="mx-auto max-h-40 bg-white p-2" />
              <p className="muted text-xs">{t("customers.indicator_hint")}</p>
              <div className="flex flex-wrap gap-2">
                <a className="btn btn-sm" href={`/api/customers/${customer.id}/sheet?format=a4`} target="_blank">{t("customers.sheet_a4")}</a>
                <a className="btn btn-sm" href={`/api/customers/${customer.id}/sheet?format=a6`} target="_blank">{t("customers.sheet_a6")}</a>
                <a className="btn btn-sm" href={`/api/customers/${customer.id}/indicator?format=png&download=1`}>PNG</a>
                <a className="btn btn-sm" href={`/api/customers/${customer.id}/indicator?format=svg&download=1`}>SVG</a>
              </div>
            </div>
          )}
        </aside>
      </form>

      {customer && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card">
            <h2 className="border-b border-[var(--border)] px-4 py-3 font-medium">{t("customers.orders")}</h2>
            <ul className="divide-y divide-[var(--border-subtle)] text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 px-4 py-2">
                  <Link href={`/orders/${o.id}`} className="font-mono text-xs hover:underline">{o.order_no}</Link>
                  <span className="muted">{new Date(`${o.delivery_date}T12:00:00Z`).toLocaleDateString(intl)}</span>
                  <OrderStatusBadge status={o.status} />
                  <span className="muted ml-auto text-xs">{o.tour_title ?? ""}</span>
                </li>
              ))}
              {!orders.length && <li className="muted px-4 py-3">{t("customers.no_orders")}</li>}
            </ul>
          </section>
          <section className="card">
            <h2 className="border-b border-[var(--border)] px-4 py-3 font-medium">{t("customers.history")}</h2>
            <ul className="divide-y divide-[var(--border-subtle)] text-sm">
              {events.map((e) => (
                <li key={e.id} className="space-y-0.5 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="muted text-xs">{new Date(e.occurred_at).toLocaleString(intl, { dateStyle: "short", timeStyle: "short" })}</span>
                    {e.outcome_code && (
                      <span className={`badge ${e.outcome_kind === "success" ? "badge-success" : e.outcome_kind === "failure" ? "badge-danger" : ""}`}>
                        {locale === "de" ? e.outcome_label_de : e.outcome_label_en}
                      </span>
                    )}
                    {!e.outcome_code && <span className="badge">{t(`event_type.${e.type}`)}</span>}
                    <span className="muted ml-auto text-xs">{e.tour_title}</span>
                  </div>
                  {(e.reason_label_en || e.reason_text) && (
                    <div className="text-xs">{t("events.reason")}: {[locale === "de" ? e.reason_label_de : e.reason_label_en, e.reason_text].filter(Boolean).join(" – ")}</div>
                  )}
                  {e.recipient_name && <div className="text-xs">{t("events.recipient")}: {e.recipient_name}{e.neighbor_info ? ` (${e.neighbor_info})` : ""}</div>}
                  <div className="flex gap-2 text-xs">
                    {e.photo_path && <a className="hover:underline" href={`/api/events/${e.id}/photo`} target="_blank">{t("events.photo")}</a>}
                    {e.signature_path && <a className="hover:underline" href={`/api/events/${e.id}/signature`} target="_blank">{t("events.signature")}</a>}
                  </div>
                </li>
              ))}
              {!events.length && <li className="muted px-4 py-3">{t("customers.no_history")}</li>}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
