"use client";

import { useMemo, useState } from "react";
import { api, euro } from "@/components/api";
import { useI18n } from "@/components/I18nProvider";
import { categoryTree } from "@/lib/category-tree";
import type { Category, Product } from "@/lib/products";

type Draft = {
  id?: string;
  category_id: string;
  sku: string;
  name: string;
  description: string;
  unit: string;
  price: string;
  vat_rate: string;
  ean13: string;
  weight_g: string;
  active: boolean;
};

const UNITS = ["pcs", "kg", "g", "l", "box", "pallet", "m"];

const emptyDraft = (category_id = ""): Draft => ({
  category_id, sku: "", name: "", description: "", unit: "pcs", price: "", vat_rate: "19", ean13: "", weight_g: "", active: true,
});

export default function ProductsClient({
  initialCategories,
  initialProducts,
}: {
  initialCategories: Category[];
  initialProducts: Product[];
}) {
  const { t, intl } = useI18n();
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [selectedCat, setSelectedCat] = useState<string | "all" | "none">("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catDraft, setCatDraft] = useState<{ id?: string; name: string; parent_id: string; sort: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const tree = useMemo(() => categoryTree(categories), [categories]);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  const visible = products.filter((p) => {
    if (selectedCat === "none" && p.category_id) return false;
    if (selectedCat !== "all" && selectedCat !== "none") {
      // include sub-categories
      const ids = new Set([selectedCat]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const c of categories) {
          if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) {
            ids.add(c.id);
            grew = true;
          }
        }
      }
      if (!p.category_id || !ids.has(p.category_id)) return false;
    }
    const s = search.trim().toLowerCase();
    return !s || p.name.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s) || (p.ean13 ?? "").includes(s);
  });

  async function reload() {
    const [c, p] = await Promise.all([
      api<{ categories: Category[] }>("/api/categories"),
      api<{ products: Product[] }>("/api/products?inactive=1"),
    ]);
    setCategories(c.categories);
    setProducts(p.products);
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function saveProduct() {
    if (!draft) return;
    const body = {
      category_id: draft.category_id || null,
      sku: draft.sku || null,
      name: draft.name,
      description: draft.description || null,
      unit: draft.unit,
      price_cents: Math.round(Number(draft.price.replace(",", ".") || 0) * 100),
      vat_rate: Number(draft.vat_rate.replace(",", ".") || 0),
      ean13: draft.ean13 || null,
      weight_g: draft.weight_g ? Number(draft.weight_g) : null,
      active: draft.active,
    };
    if (await run(() => (draft.id ? api(`/api/products/${draft.id}`, "PUT", body) : api("/api/products", "POST", body)))) setDraft(null);
  }

  async function saveCategory() {
    if (!catDraft) return;
    const body = { name: catDraft.name, parent_id: catDraft.parent_id || null, sort: catDraft.sort };
    if (await run(() => (catDraft.id ? api(`/api/categories/${catDraft.id}`, "PUT", body) : api("/api/categories", "POST", body)))) setCatDraft(null);
  }

  return (
    <main className="page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">{t("products.title")}</h1>
        <button className="btn-primary" onClick={() => setDraft(emptyDraft(selectedCat !== "all" && selectedCat !== "none" ? selectedCat : ""))}>
          {t("products.new")}
        </button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <aside className="card h-fit p-2">
          <div className="flex items-center justify-between px-2 py-1">
            <h2 className="text-sm font-medium">{t("products.categories")}</h2>
            <button className="btn btn-sm" onClick={() => setCatDraft({ name: "", parent_id: "", sort: 0 })}>+</button>
          </div>
          <CatItem label={t("products.all")} active={selectedCat === "all"} onClick={() => setSelectedCat("all")} />
          {tree.map((c) => (
            <CatItem
              key={c.id}
              label={`${c.name} (${c.product_count})`}
              depth={c.depth}
              active={selectedCat === c.id}
              onClick={() => setSelectedCat(c.id)}
              onEdit={() => setCatDraft({ id: c.id, name: c.name, parent_id: c.parent_id ?? "", sort: c.sort })}
            />
          ))}
          <CatItem label={t("products.uncategorized")} active={selectedCat === "none"} onClick={() => setSelectedCat("none")} />

          {catDraft && (
            <div className="mt-2 space-y-2 border-t border-[var(--border)] p-2">
              <label className="field">
                <span>{t("products.category_name")}</span>
                <input autoFocus value={catDraft.name} onChange={(e) => setCatDraft({ ...catDraft, name: e.target.value })} />
              </label>
              <label className="field">
                <span>{t("products.parent")}</span>
                <select value={catDraft.parent_id} onChange={(e) => setCatDraft({ ...catDraft, parent_id: e.target.value })}>
                  <option value="">—</option>
                  {tree.filter((c) => c.id !== catDraft.id).map((c) => (
                    <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t("products.sort")}</span>
                <input type="number" value={catDraft.sort} onChange={(e) => setCatDraft({ ...catDraft, sort: Number(e.target.value) })} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" onClick={saveCategory} disabled={!catDraft.name.trim()}>{t("common.save")}</button>
                <button className="btn btn-sm" onClick={() => setCatDraft(null)}>{t("common.cancel")}</button>
                {catDraft.id && (
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      if (!confirm(t("products.confirm_delete_category"))) return;
                      if (await run(() => api(`/api/categories/${catDraft.id}`, "DELETE"))) setCatDraft(null);
                    }}
                  >
                    {t("common.delete")}
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>

        <section className="space-y-3">
          <input className="input max-w-md" type="search" placeholder={t("products.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          {draft && (
            <div className="card space-y-3 p-4">
              <h2 className="font-medium">{draft.id ? t("products.edit") : t("products.new")}</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="field sm:col-span-2">
                  <span>{t("products.name")}</span>
                  <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t("products.sku")}</span>
                  <input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t("products.category")}</span>
                  <select value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                    <option value="">—</option>
                    {tree.map((c) => (
                      <option key={c.id} value={c.id}>{"  ".repeat(c.depth)}{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("products.unit")}</span>
                  <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                    {UNITS.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>{t("products.price")}</span>
                  <input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t("products.vat")}</span>
                  <input inputMode="decimal" value={draft.vat_rate} onChange={(e) => setDraft({ ...draft, vat_rate: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t("products.ean")}</span>
                  <input inputMode="numeric" maxLength={13} value={draft.ean13} onChange={(e) => setDraft({ ...draft, ean13: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t("products.weight")}</span>
                  <input inputMode="numeric" value={draft.weight_g} onChange={(e) => setDraft({ ...draft, weight_g: e.target.value })} />
                </label>
              </div>
              <label className="field">
                <span>{t("products.description")}</span>
                <textarea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                {t("products.active")}
              </label>
              <div className="flex gap-2">
                <button className="btn-primary" onClick={saveProduct} disabled={!draft.name.trim()}>{t("common.save")}</button>
                <button className="btn" onClick={() => setDraft(null)}>{t("common.cancel")}</button>
                {draft.id && (
                  <button
                    className="btn btn-danger ml-auto"
                    onClick={async () => {
                      if (!confirm(t("products.confirm_delete"))) return;
                      if (await run(() => api(`/api/products/${draft.id}`, "DELETE"))) setDraft(null);
                    }}
                  >
                    {t("common.delete")}
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("products.name")}</th>
                  <th>{t("products.sku")}</th>
                  <th>{t("products.category")}</th>
                  <th className="text-right">{t("products.price")}</th>
                  <th>{t("products.ean")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr
                    key={p.id}
                    className={`cursor-pointer ${p.active ? "" : "opacity-50"}`}
                    onClick={() =>
                      setDraft({
                        id: p.id,
                        category_id: p.category_id ?? "",
                        sku: p.sku ?? "",
                        name: p.name,
                        description: p.description ?? "",
                        unit: p.unit,
                        price: (p.price_cents / 100).toFixed(2),
                        vat_rate: String(Number(p.vat_rate)),
                        ean13: p.ean13 ?? "",
                        weight_g: p.weight_g != null ? String(p.weight_g) : "",
                        active: p.active,
                      })
                    }
                  >
                    <td className="font-medium">{p.name}<span className="muted ml-1 text-xs">/ {t(`units.${p.unit}`)}</span></td>
                    <td className="font-mono text-xs">{p.sku ?? ""}</td>
                    <td className="muted text-sm">{catName(p.category_id)}</td>
                    <td className="text-right tabular-nums">{euro(p.price_cents, intl)}</td>
                    <td className="font-mono text-xs">{p.ean13 ?? ""}</td>
                  </tr>
                ))}
                {!visible.length && <tr><td colSpan={5} className="muted py-8 text-center">{t("products.empty")}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function CatItem({ label, depth = 0, active, onClick, onEdit }: { label: string; depth?: number; active: boolean; onClick: () => void; onEdit?: () => void }) {
  return (
    <div
      className={`group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm ${active ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "hover:bg-[var(--bg-elevated)]"}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      {onEdit && (
        <button
          className="muted hidden text-xs group-hover:inline"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          ✎
        </button>
      )}
    </div>
  );
}
