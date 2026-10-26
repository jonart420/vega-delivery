import AppShell from "../AppShell";
import { requireStaff } from "@/lib/auth";
import { q } from "@/lib/db";
import { listTours } from "@/lib/tours";
import ToursClient from "./ToursClient";

export const dynamic = "force-dynamic";

export default async function ToursPage() {
  const user = await requireStaff();
  const [tours, drivers] = await Promise.all([
    listTours(),
    q<{ id: string; name: string }>(
      "select id, coalesce(display_name, username::text) as name from users where active and role in ('driver', 'dispatcher', 'admin') order by role = 'driver' desc, 2",
    ),
  ]);
  return (
    <AppShell user={user}>
      <ToursClient tours={tours} drivers={drivers} />
    </AppShell>
  );
}
