"use client";

import type { Marker } from "maplibre-gl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import PlaceSearch from "@/components/PlaceSearch";
import TourStatusBadge, { StopStatusBadge } from "@/components/TourStatusBadge";
import { fitTo, pinElement, setRouteLine, useMap } from "@/components/useMap";
import type { DeliveryEvent } from "@/lib/deliveries";
import type { GeocodeResult } from "@/lib/geocode";
import { maplibregl } from "@/lib/maplibre";
import type { OrderRow } from "@/lib/orders";
import type { Tour, TourStop } from "@/lib/tours";

type Live = {
  position: { lat: number; lon: number; heading: number | null; t: string } | null;
  events: DeliveryEvent[];
  notifications: { id: string; stop_id: string; channel: string; kind: string; recipient: string; status: string; error: string | null; created_at: string }[];
};

function fmtDuration(s: number) {
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export default function TourPlanner({
  initialTour,
  initialStops,
  drivers,
  mapStyle,
}: {
  initialTour: Tour;
  initialStops: TourStop[];
  drivers: { id: string; name: string }[];
  mapStyle: string;
}) {
  const { t, locale, intl } = useI18n();
  const router = useRouter();
  const [tour, setTour] = useState(initialTour);
  const [stops, setStops] = useState(initialStops);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [openOrders, setOpenOrders] = useState<OrderRow[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [live, setLive] = useState<Live | null>(null);
  const [tab, setTab] = useState<"stops" | "events" | "notifications">("stops");
  const [endpointEdit, setEndpointEdit] = useState<"start" | "end" | null>(null);

  const editable = tour.status === "draft" || tour.status === "released";
  const running = tour.status === "in_progress" || tour.status === "done";
  const { containerRef, mapRef, ready } = useMap(mapStyle);
  const markersRef = useRef<Marker[]>([]);
  const vehicleRef = useRef<Marker | null>(null);
  const fittedRef = useRef(false);

  const apply = useCallback((d: { tour: Tour; stops?: TourStop[] }) => {
    setTour(d.tour);
    if (d.stops) setStops(d.stops);
  }, []);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      apply((await fn()) as { tour: Tour; stops?: TourStop[] });
      if (ok) setInfo(ok);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ordered = useMemo(
    () => [...stops].sort((a, b) => (a.sort_index ?? 1e9) - (b.sort_index ?? 1e9) || a.zip.localeCompare(b.zip)),
    [stops],
  );

  // ── Map markers & route ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const pts: [number, number][] = [];
    const routed = tour.route != null;
    ordered.forEach((s, i) => {
      if (s.lat == null || s.lon == null) return;
      const el = pinElement(routed ? String(s.sort_index ?? i + 1) : "•", {
        status: s.status,
        fixed: s.fixed_position != null,
        selected: selected === s.id,
        unrouted: !routed && s.status === "pending",
      });
      el.title = `${s.name} – ${s.street} ${s.house_no ?? ""}`;
      el.onclick = () => setSelected(s.id);
      markersRef.current.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([s.lon, s.lat]).addTo(map));
      pts.push([s.lon, s.lat]);
    });
    for (const which of ["start", "end"] as const) {
      const lat = tour[`${which}_lat`];
      const lon = tour[`${which}_lon`];
      if (lat == null || lon == null) continue;
      if (which === "end" && lat === tour.start_lat && lon === tour.start_lon) continue;
      const el = document.createElement("div");
      el.className = "vd-depot";
      el.textContent = which === "start" ? "⌂" : "⚑";
      el.title = tour[`${which}_label`] ?? t(`tours.${which}`);
      markersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map));
      pts.push([lon, lat]);
    }
    setRouteLine(map, tour.route?.geometry ?? null);
    if (!fittedRef.current && pts.length) {
      fitTo(map, pts, 70);
      fittedRef.current = true;
    }
  }, [ready, ordered, tour, selected, mapRef, t]);

  // ── Live polling while running ──────────────────────────────────
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await api<{ tour: Tour; stops: TourStop[] } & Live>(`/api/tours/${tour.id}/live`);
        if (stop) return;
        setTour(r.tour);
        setStops(r.stops);
        setLive({ position: r.position, events: r.events, notifications: r.notifications });
      } catch {
        // keep last state, next poll retries
      }
    };
    load();
    const timer = setInterval(load, tour.status === "in_progress" ? 15_000 : 120_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [running, tour.id, tour.status]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const p = live?.position;
    if (!p) {
      vehicleRef.current?.remove();
      vehicleRef.current = null;
      return;
    }
    if (!vehicleRef.current) {
      const el = document.createElement("div");
      el.className = "vd-vehicle";
      el.title = t("tours.vehicle_position");
      vehicleRef.current = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    } else vehicleRef.current.setLngLat([p.lon, p.lat]);
  }, [live?.position, ready, mapRef, t]);

  // ── Open orders to add ──────────────────────────────────────────
  useEffect(() => {
    if (!showAdd) return;
    api<{ orders: OrderRow[] }>(`/api/orders?status=open&unplanned=1&date=${tour.date}`)
      .then((r) => setOpenOrders(r.orders))
      .catch((e) => setError((e as Error).message));
  }, [showAdd, tour.date, stops.length]);

  const patch = (body: Record<string, unknown>) => run(() => api<{ tour: Tour; stops: TourStop[] }>(`/api/tours/${tour.id}`, "PATCH", body));

  function move(id: string, dir: -1 | 1) {
    const ids = ordered.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => api(`/api/tours/${tour.id}/route`, "POST", { order: ids }));
  }

  function pickEndpoint(r: GeocodeResult) {
    if (!endpointEdit) return;
    const label = r.sublabel ? `${r.label}, ${r.sublabel}` : r.label;
    patch({ [endpointEdit]: { lat: r.lat, lon: r.lon, label } });
    setEndpointEdit(null);
  }

  const stopById = useMemo(() => new Map(stops.map((s) => [s.id, s])), [stops]);
  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" }) : "");
  const missingCoords = stops.filter((s) => s.lat == null).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* ── Left panel ────────────────────────────────────────── */}
      <aside className="flex max-h-[60vh] w-full shrink-0 flex-col border-b border-[var(--border)] bg-[var(--bg-surface)] lg:max-h-none lg:w-[var(--panel-width)] lg:border-r lg:border-b-0">
        <div className="space-y-3 border-b border-[var(--border)] p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href="/tours" className="muted text-xs hover:underline">← {t("tours.title")}</Link>
              <input
                className="block w-full truncate bg-transparent text-lg font-semibold outline-none"
                defaultValue={tour.title}
                onBlur={(e) => e.target.value.trim() && e.target.value !== tour.title && patch({ title: e.target.value })}
              />
            </div>
            <TourStatusBadge status={tour.status} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="field">
              <span>{t("tours.date")}</span>
              <input type="date" disabled={!editable} value={tour.date} onChange={(e) => patch({ date: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("tours.planned_start")}</span>
              <input type="time" disabled={!editable} value={tour.planned_start ?? ""} onChange={(e) => patch({ planned_start: e.target.value })} />
            </label>
            <label className="field">
              <span>{t("tours.driver")}</span>
              <select disabled={running} value={tour.driver_id ?? ""} onChange={(e) => patch({ driver_id: e.target.value || null })}>
                <option value="">—</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t("tours.vehicle")}</span>
              <input disabled={running} defaultValue={tour.vehicle ?? ""} onBlur={(e) => e.target.value !== (tour.vehicle ?? "") && patch({ vehicle: e.target.value })} />
            </label>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-[var(--text-secondary)]">
              {t("tours.start")}: {tour.start_label ?? (tour.start_lat != null ? t("tours.depot") : t("tours.not_set"))}
              {" · "}{t(`modes.${tour.mode}`)}
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-sm" disabled={!editable} onClick={() => setEndpointEdit("start")}>{t("tours.change_start")}</button>
                <button className="btn btn-sm" disabled={!editable} onClick={() => setEndpointEdit("end")}>{t("tours.change_end")}</button>
                <select className="input !w-auto !py-1 text-xs" disabled={!editable} value={tour.mode} onChange={(e) => patch({ mode: e.target.value })}>
                  {(["auto", "bicycle", "pedestrian"] as const).map((m) => <option key={m} value={m}>{t(`modes.${m}`)}</option>)}
                </select>
              </div>
              {endpointEdit && (
                <PlaceSearch
                  onPick={pickEndpoint}
                  getCenter={() => (tour.start_lat != null ? { lat: tour.start_lat, lon: tour.start_lon! } : null)}
                  placeholder={t(endpointEdit === "start" ? "tours.search_start" : "tours.search_end")}
                />
              )}
              <p className="muted text-xs">{t("tours.end")}: {tour.end_label ?? (tour.end_lat === tour.start_lat ? t("tours.same_as_start") : "—")}</p>
            </div>
          </details>

          {tour.route && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span><b>{tour.route.distance_km.toFixed(1)}</b> km</span>
              <span>{t("tours.driving")} <b>{fmtDuration(tour.route.duration_s)}</b></span>
              <span className="muted">{t(`tours.order_${tour.route.order_mode}`)}</span>
            </div>
          )}
          {missingCoords > 0 && <div className="alert alert-error text-xs">{t("tours.missing_coords", { n: missingCoords })}</div>}
          {error && <div className="alert alert-error text-xs">{error}</div>}
          {info && <div className="alert alert-ok text-xs">{info}</div>}

          <div className="flex flex-wrap gap-2">
            {editable && (
              <>
                <button className="btn-primary" disabled={busy || !stops.length} onClick={() => run(() => api(`/api/tours/${tour.id}/route`, "POST", {}), t("tours.optimized"))}>
                  {busy ? t("common.working") : tour.route ? t("tours.reoptimize") : t("tours.optimize")}
                </button>
                <button className="btn" onClick={() => setShowAdd((v) => !v)}>{showAdd ? t("tours.hide_orders") : t("tours.add_orders")}</button>
              </>
            )}
            {tour.status === "draft" && (
              <button className="btn" disabled={busy || !tour.route || !tour.driver_id} title={!tour.driver_id ? t("tours.driver_required") : ""}
                onClick={() => run(() => api(`/api/tours/${tour.id}/release`, "POST"), t("tours.released"))}>
                {t("tours.release")}
              </button>
            )}
            {tour.status === "released" && (
              <button className="btn" disabled={busy} onClick={() => run(() => api(`/api/tours/${tour.id}/release`, "DELETE"))}>{t("tours.unrelease")}</button>
            )}
            {tour.status === "in_progress" && (
              <>
                <button className="btn" disabled={busy} onClick={() => run(async () => { await api(`/api/tours/${tour.id}/notify`, "POST", {}); return { tour }; }, t("tours.notified"))}>
                  {t("tours.notify_all")}
                </button>
                <button className="btn" disabled={busy} onClick={() => confirm(t("tours.confirm_finish")) && run(() => api(`/api/tours/${tour.id}/finish`, "POST"))}>
                  {t("tours.finish")}
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <a className="btn btn-sm" href={`/api/tours/${tour.id}/sheet`} target="_blank">{t("tours.loading_list")}</a>
            <a className="btn btn-sm" href={`/api/tours/${tour.id}/labels`} target="_blank">{t("tours.labels")}</a>
            <a className="btn btn-sm" href={`/api/tours/${tour.id}/customer-sheets`} target="_blank">{t("tours.customer_sheets")}</a>
            {editable && (
              <button className="btn btn-sm btn-danger ml-auto" onClick={async () => {
                if (!confirm(t("tours.confirm_delete"))) return;
                await api(`/api/tours/${tour.id}`, "DELETE");
                router.push("/tours");
              }}>
                {t("common.delete")}
              </button>
            )}
          </div>
        </div>

        {running && (
          <div className="tabs px-2">
            {(["stops", "events", "notifications"] as const).map((k) => (
              <button key={k} className={`tab ${tab === k ? "tab-active" : ""}`} onClick={() => setTab(k)}>{t(`tours.tab_${k}`)}</button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "stops" && (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {ordered.map((s, i) => (
                <li
                  key={s.id}
                  className={`flex gap-2 px-3 py-2 text-sm ${selected === s.id ? "bg-[var(--accent-dim)]" : ""}`}
                  onClick={() => {
                    setSelected(s.id);
                    if (s.lat != null) mapRef.current?.flyTo({ center: [s.lon!, s.lat], zoom: Math.max(mapRef.current.getZoom(), 14) });
                  }}
                >
                  <span className="w-6 shrink-0 pt-0.5 text-right font-semibold tabular-nums">{tour.route ? s.sort_index : "·"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      {running && <StopStatusBadge status={s.status} />}
                    </div>
                    <div className="muted truncate text-xs">{[s.street, s.house_no].filter(Boolean).join(" ")}, {s.zip} {s.city}</div>
                    <div className="muted flex flex-wrap gap-x-2 text-xs">
                      {s.eta && <span>ETA {fmtTime(s.eta)}</span>}
                      {s.time_window_from && <span>⏱ {s.time_window_from}–{s.time_window_to ?? ""}</span>}
                      <span>{s.orders.map((o) => o.order_no).join(", ")}</span>
                      {(s.notify_email || s.notify_whatsapp) && <span title={t("customers.notifications")}>✉</span>}
                    </div>
                    {selected === s.id && running && (
                      <div className="mt-1 flex gap-2">
                        <a className="btn btn-sm" href={`/t/${s.tracking_token}`} target="_blank" onClick={(e) => e.stopPropagation()}>{t("tours.tracking_page")}</a>
                        {tour.status === "in_progress" && (
                          <button className="btn btn-sm" onClick={(e) => {
                            e.stopPropagation();
                            run(async () => { await api(`/api/tours/${tour.id}/notify`, "POST", { stop_id: s.id }); return { tour }; }, t("tours.notified"));
                          }}>
                            {t("tours.notify")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {editable && (
                    <div className="flex shrink-0 flex-col items-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex">
                        <button className="btn btn-sm !px-1.5" disabled={busy || i === 0 || !tour.route} onClick={() => move(s.id, -1)} title={t("tours.move_up")}>▲</button>
                        <button className="btn btn-sm !px-1.5" disabled={busy || i === ordered.length - 1 || !tour.route} onClick={() => move(s.id, 1)} title={t("tours.move_down")}>▼</button>
                      </div>
                      <div className="flex">
                        <button
                          className={`btn btn-sm !px-1.5 ${s.fixed_position != null ? "!text-[var(--accent)]" : ""}`}
                          title={t("tours.fix_hint")}
                          disabled={busy || !tour.route}
                          onClick={() => run(() => api(`/api/tours/${tour.id}/stops/${s.id}`, "PATCH", { fixed_position: s.fixed_position != null ? null : s.sort_index }))}
                        >
                          📌
                        </button>
                        <button className="btn btn-sm btn-danger !px-1.5" title={t("tours.remove_stop")} disabled={busy}
                          onClick={() => run(() => api(`/api/tours/${tour.id}/orders?stop=${s.id}`, "DELETE"))}>
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
              {!stops.length && <li className="muted p-4 text-sm">{t("tours.no_stops")}</li>}
            </ul>
          )}
          {tab === "events" && (
            <ul className="divide-y divide-[var(--border-subtle)] text-sm">
              {(live?.events ?? []).map((e) => (
                <li key={e.id} className="space-y-0.5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="muted text-xs tabular-nums">{fmtTime(e.occurred_at)}</span>
                    {e.outcome_code ? (
                      <span className={`badge ${e.outcome_kind === "success" ? "badge-success" : e.outcome_kind === "failure" ? "badge-danger" : ""}`}>
                        {locale === "de" ? e.outcome_label_de : e.outcome_label_en}
                      </span>
                    ) : (
                      <span className="badge">{t(`event_type.${e.type}`)}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{e.customer_label}</span>
                  </div>
                  {(e.reason_label_en || e.reason_text) && (
                    <div className="text-xs">{t("events.reason")}: {[locale === "de" ? e.reason_label_de : e.reason_label_en, e.reason_text].filter(Boolean).join(" – ")}</div>
                  )}
                  {e.recipient_name && <div className="text-xs">{t("events.recipient")}: {e.recipient_name}{e.neighbor_info ? ` (${e.neighbor_info})` : ""}</div>}
                  {e.note && <div className="muted text-xs">{e.note}</div>}
                  <div className="flex gap-2 text-xs">
                    {e.photo_path && <a className="underline" href={`/api/events/${e.id}/photo`} target="_blank">{t("events.photo")}</a>}
                    {e.signature_path && <a className="underline" href={`/api/events/${e.id}/signature`} target="_blank">{t("events.signature")}</a>}
                    {e.scanned_codes?.length ? <span className="muted">{t("events.scanned")}: {e.scanned_codes.length}</span> : null}
                    {e.user_name && <span className="muted ml-auto">{e.user_name}</span>}
                  </div>
                </li>
              ))}
              {!live?.events.length && <li className="muted p-4">{t("tours.no_events")}</li>}
            </ul>
          )}
          {tab === "notifications" && (
            <ul className="divide-y divide-[var(--border-subtle)] text-sm">
              {(live?.notifications ?? []).map((n) => (
                <li key={n.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="muted text-xs tabular-nums">{fmtTime(n.created_at)}</span>
                    <span className="chip">{t(`channels.${n.channel}`)}</span>
                    <span className="text-xs">{t(`notify_kind.${n.kind}`)}</span>
                    <span className={`badge ml-auto ${n.status === "sent" ? "badge-success" : n.status === "failed" ? "badge-danger" : ""}`}>{t(`notify_status.${n.status}`)}</span>
                  </div>
                  <div className="muted truncate text-xs">{stopById.get(n.stop_id)?.name} · {n.recipient}</div>
                  {n.error && <div className="text-xs text-[var(--danger)]">{n.error}</div>}
                </li>
              ))}
              {!live?.notifications.length && <li className="muted p-4">{t("tours.no_notifications")}</li>}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Map ─────────────────────────────────────────────────── */}
      <div className="relative min-h-[50vh] flex-1">
        {/* MapLibre sets position: relative on its container, so the sizing lives on a wrapper */}
        <div className="absolute inset-0">
          <div ref={containerRef} className="h-full w-full" />
        </div>
      </div>

      {/* ── Add orders ──────────────────────────────────────────── */}
      {showAdd && editable && (
        <aside className="flex w-full shrink-0 flex-col border-t border-[var(--border)] bg-[var(--bg-surface)] lg:w-[340px] lg:border-t-0 lg:border-l">
          <div className="space-y-2 border-b border-[var(--border)] p-3">
            <h2 className="font-medium">{t("tours.open_orders", { date: new Date(`${tour.date}T12:00:00Z`).toLocaleDateString(intl) })}</h2>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => setPick(new Set(openOrders.map((o) => o.id)))}>{t("common.select_all")}</button>
              <button className="btn-primary btn-sm" disabled={!pick.size || busy}
                onClick={() => run(() => api(`/api/tours/${tour.id}/orders`, "POST", { order_ids: [...pick] })).then(() => setPick(new Set()))}>
                {t("tours.add_selected", { n: pick.size })}
              </button>
            </div>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto text-sm">
            {openOrders.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer gap-2 px-3 py-2">
                  <input type="checkbox" checked={pick.has(o.id)} onChange={() => setPick((p) => { const n = new Set(p); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; })} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{[[o.first_name, o.last_name].filter(Boolean).join(" "), o.company].filter(Boolean).join(" - ")}</div>
                    <div className="muted truncate text-xs">{o.zip} {o.city} · {o.order_no}</div>
                  </div>
                </label>
              </li>
            ))}
            {!openOrders.length && <li className="muted p-3">{t("tours.no_open_orders")}</li>}
          </ul>
        </aside>
      )}
    </div>
  );
}
