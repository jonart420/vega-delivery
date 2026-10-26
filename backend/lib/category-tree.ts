import type { Category } from "./products";

/** Categories as a flat list in tree order with depth (for selects and the tree view). */
export function categoryTree(cats: Category[]): (Category & { depth: number })[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    const key = c.parent_id && cats.some((x) => x.id === c.parent_id) ? c.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  const out: (Category & { depth: number })[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const c of byParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ ...c, depth });
      walk(c.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());
  return out;
}
