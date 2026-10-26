"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import LocaleSwitch from "@/components/LocaleSwitch";
import type { Locale } from "@/lib/i18n-core";
import LogoutButton from "./LogoutButton";

export type NavItem = { href: string; label: string; exact?: boolean; match?: string; tab?: string };
export type NavGroup = { id: string; label: string; icon: string; href?: string; exact?: boolean; items?: NavItem[] };

const STORAGE_KEY = "vd_nav_open";

/**
 * Vertical navigation. Groups open like a dropdown (state remembered per browser); the group of
 * the current page is always open. On small screens the sidebar slides in from a menu button.
 */
export default function Sidebar({
  groups,
  brand,
  logo,
  locale,
  userName,
  role,
  labels,
}: {
  groups: NavGroup[];
  brand: string;
  logo: string | null;
  locale: Locale;
  userName: string;
  role: string;
  labels: { menu: string; logout: string };
}) {
  const path = usePathname();
  const search = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore per-browser preference after hydration
      setOpen(saved);
    } catch {
      // no stored state (private mode etc.)
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile drawer on navigation
  useEffect(() => setMobileOpen(false), [path, search]);

  const itemActive = (i: NavItem) => {
    if (i.tab) return path === i.match && (search.get("tab") ?? "general") === i.tab;
    return i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/");
  };
  // Most specific item wins (e.g. /orders/new must not also highlight /orders)
  const activeHref = groups
    .flatMap((g) => g.items ?? [])
    .filter(itemActive)
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = { ...cur, [id]: !(cur[id] ?? true) };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });

  const brandEl = (
    <Link href="/" className="flex items-center gap-2 font-semibold">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {logo ? <img src={logo} alt={brand} className="h-8 w-auto max-w-[160px]" /> : <span>{brand}</span>}
    </Link>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 md:hidden">
        <button className="btn !px-2.5" aria-label={labels.menu} aria-expanded={mobileOpen} onClick={() => setMobileOpen((v) => !v)}>
          ☰
        </button>
        {brandEl}
      </div>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMobileOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] transition-transform md:static md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center border-b border-[var(--border)] px-4">{brandEl}</div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 text-sm">
          {groups.map((g) => {
            if (g.href) {
              const active = g.exact ? path === g.href : path.startsWith(g.href);
              return (
                <Link key={g.id} href={g.href} className={`nav-item ${active ? "nav-item-active" : ""}`}>
                  <span className="w-5 text-center opacity-70">{g.icon}</span>
                  {g.label}
                </Link>
              );
            }
            const containsActive = (g.items ?? []).some((i) => i.href === activeHref);
            const isOpen = containsActive || (open[g.id] ?? true);
            return (
              <div key={g.id}>
                <button className="nav-item w-full" aria-expanded={isOpen} onClick={() => toggle(g.id)}>
                  <span className="w-5 text-center opacity-70">{g.icon}</span>
                  <span className="flex-1 text-left">{g.label}</span>
                  <span className={`text-xs opacity-60 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {isOpen && (
                  <div className="mt-0.5 ml-5 space-y-0.5 border-l border-[var(--border)] pl-3">
                    {g.items!.map((i) => (
                      <Link key={i.href} href={i.href} className={`nav-sub ${i.href === activeHref ? "nav-item-active" : ""}`}>
                        {i.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-[var(--border)] p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{userName}</div>
              <div className="muted text-xs">{role}</div>
            </div>
            <LocaleSwitch current={locale} />
          </div>
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}
