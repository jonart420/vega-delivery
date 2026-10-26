import AppShell from "../AppShell";
import { requireStaff } from "@/lib/auth";
import { listCategories, listProducts } from "@/lib/products";
import ProductsClient from "./ProductsClient";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const user = await requireStaff();
  const [categories, products] = await Promise.all([listCategories(), listProducts({ includeInactive: true })]);
  return (
    <AppShell user={user}>
      <ProductsClient initialCategories={categories} initialProducts={products} />
    </AppShell>
  );
}
