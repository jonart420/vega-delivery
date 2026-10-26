import AppShell from "../../AppShell";
import { requireStaff } from "@/lib/auth";
import { mapStyleUrl } from "@/lib/map";
import CustomerForm from "../CustomerForm";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  const user = await requireStaff();
  return (
    <AppShell user={user}>
      <CustomerForm customer={null} mapStyle={mapStyleUrl()} orders={[]} events={[]} />
    </AppShell>
  );
}
