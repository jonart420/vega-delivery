import { z } from "zod";
import { clean } from "./api";
import { isValidGtin } from "./barcodes";
import { q } from "./db";

export type Category = { id: string; parent_id: string | null; name: string; sort: number; product_count: number };

export type Product = {
  id: string;
  category_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  price_cents: number;
  vat_rate: string;
  ean13: string | null;
  weight_g: number | null;
  active: boolean;
};

export const CategoryInput = z.object({
  name: z.string().min(1).max(120).transform((v) => v.normalize("NFC").trim()),
  parent_id: z.string().uuid().nullish(),
  sort: z.number().int().min(-10000).max(10000).default(0),
});

export const ProductInput = z.object({
  category_id: z.string().uuid().nullish(),
  sku: z.string().max(60).nullish().transform((v) => clean(v ?? null)),
  name: z.string().min(1).max(200).transform((v) => v.normalize("NFC").trim()),
  description: z.string().max(2000).nullish().transform((v) => clean(v ?? null)),
  unit: z.string().min(1).max(20).default("pcs"),
  price_cents: z.number().int().min(0).max(100_000_000).default(0),
  vat_rate: z.number().min(0).max(100).default(19),
  ean13: z
    .string()
    .nullish()
    .transform((v) => clean(v ?? null))
    .refine((v) => !v || isValidGtin(v, 13), "invalid EAN-13 (check digit)"),
  weight_g: z.number().int().min(0).max(10_000_000).nullish(),
  active: z.boolean().default(true),
});

export async function listCategories(): Promise<Category[]> {
  return q<Category>(
    `select c.id, c.parent_id, c.name, c.sort, (select count(*)::int from products p where p.category_id = c.id) as product_count
       from product_categories c order by c.sort, c.name`,
  );
}

export async function listProducts(opts: { includeInactive?: boolean } = {}): Promise<Product[]> {
  return q<Product>(
    `select id, category_id, sku, name, description, unit, price_cents, vat_rate::text, ean13, weight_g, active
       from products ${opts.includeInactive ? "" : "where active"} order by name`,
  );
}

export { categoryTree } from "./category-tree";
