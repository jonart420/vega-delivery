import AppShell from "../AppShell";
import { requireStaff } from "@/lib/auth";
import { listCustomers } from "@/lib/customers";
import CustomerList from "./CustomerList";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const user = await requireStaff();
  return (
    <AppShell user={user}>
      <CustomerList initial={await listCustomers({ limit: 200 })} />
    </AppShell>
  );
}
