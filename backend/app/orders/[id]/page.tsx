import { notFound } from "next/navigation";
import AppShell from "../../AppShell";
import { isUuid } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { getOrder } from "@/lib/orders";
import { listProducts } from "@/lib/products";
import OrderForm from "../OrderForm";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();
  return (
    <AppShell user={user}>
      <OrderForm order={order} products={await listProducts()} initialCustomer={order.customer} />
    </AppShell>
  );
}
