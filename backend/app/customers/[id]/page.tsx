import { notFound } from "next/navigation";
import AppShell from "../../AppShell";
import { isUuid } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { mapStyleUrl } from "@/lib/map";
import { getCustomer } from "@/lib/customers";
import { eventsForCustomer } from "@/lib/deliveries";
import { listOrders } from "@/lib/orders";
import CustomerForm from "../CustomerForm";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const [orders, events] = await Promise.all([listOrders({ customerId: id, limit: 100 }), eventsForCustomer(id)]);
  return (
    <AppShell user={user}>
      <CustomerForm customer={customer} mapStyle={mapStyleUrl()} orders={orders} events={events} />
    </AppShell>
  );
}
