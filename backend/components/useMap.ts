"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { maplibregl } from "@/lib/maplibre";

/** Fallback centre when nothing else is known (overridable via NEXT_PUBLIC_MAP_CENTER="lon,lat"). */
export function defaultCenter(): [number, number] {
  const env = process.env.NEXT_PUBLIC_MAP_CENTER?.split(",").map(Number);
  return env && env.length === 2 && env.every(Number.isFinite) ? [env[0], env[1]] : [10.0, 53.55];
}

/**
 * Creates a MapLibre map once for the container. `ready` turns true after the style loaded;
 * a "route" GeoJSON line source/layer is prepared for route geometries.
 */
export function useMap(styleUrl: string, opts: { center?: [number, number]; zoom?: number } = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: opts.center ?? defaultCenter(),
      zoom: opts.zoom ?? 11,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2563eb";
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": accent, "line-width": 4.5 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  return { containerRef, mapRef, ready };
}

export function setRouteLine(map: MlMap | null, coords: [number, number][] | null) {
  const src = map?.getSource("route") as GeoJSONSource | undefined;
  src?.setData({
    type: "FeatureCollection",
    features: coords?.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [],
  });
}

export function fitTo(map: MlMap | null, points: [number, number][], padding = 60) {
  if (!map || !points.length) return;
  if (points.length === 1) {
    map.jumpTo({ center: points[0], zoom: 15 });
    return;
  }
  const b = new maplibregl.LngLatBounds(points[0], points[0]);
  points.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding, duration: 0, maxZoom: 16 });
}

export function pinElement(label: string, attrs: Record<string, string | boolean | undefined> = {}): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "vd-pin";
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.dataset[k] = String(v);
  el.innerHTML = `<span class="vd-pin-body"></span><span class="vd-pin-num"></span>`;
  (el.querySelector(".vd-pin-num") as HTMLElement).textContent = label;
  return el;
}
