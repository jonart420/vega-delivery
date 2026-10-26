"use client";

import type { Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { fitTo, useMap } from "@/components/useMap";
import { intlLocale, makeT, type Locale } from "@/lib/i18n-core";
import { maplibregl } from "@/lib/maplibre";
import type { PublicTracking } from "@/lib/tracking";

export default function TrackingView({
  token,
  initial,
  locale,
  brand,
  mapStyle,
  title,
}: {
  token: string;
  initial: PublicTracking;
  locale: Locale;
  brand: { name: string; color: string; logo: string | null; phone: string };
  mapStyle: string;
  title: string;
}) {
  const t = useMemo(() => makeT(locale), [locale]);
  const intl = intlLocale(locale);
  const [data, setData] = useState(initial);
  const showMap = data.state === "active" || data.state === "arrived";
  const { containerRef, mapRef, ready } = useMap(mapStyle, {
    center: data.destination ? [data.destination.lon, data.destination.lat] : undefined,
    zoom: 13,
  });
  const vehicleRef = useRef<Marker | null>(null);
  const homeRef = useRef<Marker | null>(null);

  useEffect(() => {
    if (["delivered", "failed", "expired"].includes(data.state)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/t/${token}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok) setData((await res.json()) as PublicTracking);
    }, 15_000);
    return () => clearInterval(timer);
  }, [token, data.state]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.resize();
    if (data.destination && !homeRef.current) {
      const el = document.createElement("div");
      el.className = "vd-home";
      el.textContent = "⌂";
      homeRef.current = new maplibregl.Marker({ element: el }).setLngLat([data.destination.lon, data.destination.lat]).addTo(map);
    }
    if (data.vehicle) {
      if (!vehicleRef.current) {
        const el = document.createElement("div");
        el.className = "vd-vehicle";
        vehicleRef.current = new maplibregl.Marker({ element: el }).setLngLat([data.vehicle.lon, data.vehicle.lat]).addTo(map);
        const pts: [number, number][] = [[data.vehicle.lon, data.vehicle.lat]];
        if (data.destination) pts.push([data.destination.lon, data.destination.lat]);
        fitTo(map, pts, 60);
      } else vehicleRef.current.setLngLat([data.vehicle.lon, data.vehicle.lat]);
    } else {
      vehicleRef.current?.remove();
      vehicleRef.current = null;
    }
  }, [data, ready, mapRef, showMap]);

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(intl, { hour: "2-digit", minute: "2-digit" }) : "—");
  const date = new Date(`${data.tour_date}T12:00:00Z`).toLocaleDateString(intl, { weekday: "long", day: "numeric", month: "long" });
  const outcomeLabel = data.outcome ? (locale === "de" ? data.outcome.label_de : data.outcome.label_en) : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4" style={{ ["--accent" as string]: brand.color }}>
      <header className="flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logo ? <img src={brand.logo} alt={brand.name} className="h-9 w-auto" /> : <span className="text-lg font-semibold">{brand.name}</span>}
        <span className="muted text-xs">{title}</span>
      </header>

      <section className="card space-y-2 p-5">
        <p className="muted text-sm">{t("tracking.hello", { name: data.first_name ?? "" })}</p>
        {data.state === "scheduled" && (
          <>
            <h1 className="text-xl font-semibold">{t("tracking.scheduled_title", { date })}</h1>
            {data.eta && <p>{t("tracking.planned_around", { time: time(data.eta) })}</p>}
            <p className="muted text-sm">{t("tracking.scheduled_hint", { n: data.lead_stops })}</p>
          </>
        )}
        {data.state === "waiting" && (
          <>
            <h1 className="text-xl font-semibold">{t("tracking.waiting_title")}</h1>
            {data.eta && <p>{t("tracking.expected_around", { time: time(data.eta) })}</p>}
            <p className="muted text-sm">{t("tracking.waiting_hint", { n: data.lead_stops, ahead: data.stops_ahead ?? "?" })}</p>
          </>
        )}
        {data.state === "active" && (
          <>
            <h1 className="text-xl font-semibold">{t("tracking.active_title")}</h1>
            <p className="text-3xl font-bold tabular-nums" style={{ color: brand.color }}>{time(data.eta)}</p>
            <p className="text-sm">{data.stops_ahead === 0 ? t("tracking.you_are_next") : t("tracking.stops_ahead", { n: data.stops_ahead ?? 0 })}</p>
          </>
        )}
        {data.state === "arrived" && <h1 className="text-xl font-semibold">{t("tracking.arrived_title")}</h1>}
        {data.state === "delivered" && (
          <>
            <h1 className="text-xl font-semibold text-[var(--success)]">✓ {outcomeLabel ?? t("tracking.delivered_title")}</h1>
            <p className="muted text-sm">{data.completed_at && new Date(data.completed_at).toLocaleString(intl, { dateStyle: "medium", timeStyle: "short" })}</p>
          </>
        )}
        {data.state === "failed" && (
          <>
            <h1 className="text-xl font-semibold text-[var(--danger)]">{outcomeLabel ?? t("tracking.failed_title")}</h1>
            <p className="text-sm">{t("tracking.failed_hint")}</p>
          </>
        )}
        {data.state === "expired" && <h1 className="text-xl font-semibold">{t("tracking.expired_title")}</h1>}
        <p className="muted pt-2 text-sm">{t("tracking.address")}: {data.address}</p>
      </section>

      <section className={`card overflow-hidden ${showMap ? "" : "hidden"}`}>
        <div ref={containerRef} className="h-80 w-full" />
        {!data.vehicle && showMap && <p className="muted px-3 py-2 text-xs">{t("tracking.no_position")}</p>}
      </section>

      {brand.phone && (
        <p className="muted text-center text-sm">
          {t("tracking.questions")} <a className="underline" href={`tel:${brand.phone.replace(/\s/g, "")}`}>{brand.phone}</a>
        </p>
      )}
      <p className="muted text-center text-xs">{t("tracking.refresh_hint")}</p>
    </main>
  );
}
