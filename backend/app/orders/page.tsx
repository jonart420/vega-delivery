import AppShell from "../AppShell";
import { requireStaff } from "@/lib/auth";
import { listOrders, ORDER_STATUSES, type OrderStatus } from "@/lib/orders";
import { listTours } from "@/lib/tours";
import OrderList from "./OrderList";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const status = ORDER_STATUSES.includes(sp.status as OrderStatus) ? (sp.status as OrderStatus) : null;
  const filters = { date: sp.date ?? "", status: status ?? "", q: sp.q ?? "" };
  const [orders, tours] = await Promise.all([
    listOrders({ date: filters.date || null, status, search: filters.q || null }),
    listTours({ statuses: ["draft", "released"] }),
  ]);
  return (
    <AppShell user={user}>
      <OrderList orders={orders} filters={filters} tours={tours.map((t) => ({ id: t.id, title: t.title, date: t.date }))} />
    </AppShell>
  );
}
