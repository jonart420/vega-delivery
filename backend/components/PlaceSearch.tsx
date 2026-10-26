"use client";

import { useEffect, useRef, useState } from "react";
import type { GeocodeResult } from "@/lib/geocode";
import { useI18n } from "./I18nProvider";

/**
 * Search field for addresses, streets, places and POIs (OSM via /api/geocode).
 * Keys: ↑/↓ select, Enter pick, Esc clear.
 */
export default function PlaceSearch({
  getCenter,
  onPick,
  placeholder,
}: {
  getCenter: () => { lat: number; lon: number } | null;
  onPick: (r: GeocodeResult) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    // Below 3 characters the list is not shown anyway
    if (q.length < 3) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        const c = getCenter();
        if (c) {
          params.set("lat", String(c.lat));
          params.set("lon", String(c.lon));
        }
        const res = await fetch(`/api/geocode?${params}`);
        const json = (await res.json()) as { results: GeocodeResult[]; error?: string };
        if (mine !== seq.current) return; // outdated response
        setResults(json.results ?? []);
        setError(json.error ?? null);
        setActive(0);
        setOpen(true);
      } catch {
        if (mine === seq.current) setError(t("search.unreachable"));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, getCenter, t]);

  const pick = (r: GeocodeResult) => {
    onPick(r);
    setOpen(false);
    setQuery(r.sublabel ? `${r.label}, ${r.sublabel}` : r.label);
  };

  return (
    <div className="relative">
      <input
        type="search"
        className="input"
        placeholder={placeholder ?? t("search.placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setQuery("");
            setOpen(false);
          }
        }}
        aria-label={t("search.label")}
        aria-autocomplete="list"
        data-testid="place-search"
      />
      {loading && <span className="absolute right-3 top-2.5 text-xs text-[var(--text-muted)]">…</span>}
      {open && query.trim().length >= 3 && (results.length > 0 || error || !loading) && (
        <ul
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl"
          role="listbox"
        >
          {error && <li className="px-3 py-2 text-sm text-red-400">{error}</li>}
          {!error && !results.length && !loading && (
            <li className="px-3 py-2 text-sm text-[var(--text-muted)]">{t("search.nothing")}</li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id + i}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-[var(--bg-hover)]" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{r.label}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{t(`search.kind.${r.kind}`) === `search.kind.${r.kind}` ? r.kind : t(`search.kind.${r.kind}`)}</span>
              </div>
              {r.sublabel && <div className="truncate text-xs text-[var(--text-secondary)]">{r.sublabel}</div>}
            </li>
          ))}
          <li className="px-3 py-1 text-[10px] text-[var(--text-muted)]">Photon · © OpenStreetMap contributors</li>
        </ul>
      )}
    </div>
  );
}
