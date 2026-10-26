import AppShell from "../../AppShell";
import { isUuid } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { getCustomer } from "@/lib/customers";
import { listProducts } from "@/lib/products";
import OrderForm from "../OrderForm";

export const dynamic = "force-dynamic";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requireStaff();
  const { customer } = await searchParams;
  const c = isUuid(customer) ? await getCustomer(customer) : null;
  return (
    <AppShell user={user}>
      <OrderForm order={null} products={await listProducts()} initialCustomer={c} />
    </AppShell>
  );
}
