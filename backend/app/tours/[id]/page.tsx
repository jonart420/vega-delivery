import { notFound } from "next/navigation";
import AppShell from "../../AppShell";
import { isUuid } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { mapStyleUrl } from "@/lib/map";
import { q } from "@/lib/db";
import { getStops, getTour } from "@/lib/tours";
import TourPlanner from "./TourPlanner";

export const dynamic = "force-dynamic";

export default async function TourPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tour = await getTour(id);
  if (!tour) notFound();
  const [stops, drivers] = await Promise.all([
    getStops(id),
    q<{ id: string; name: string }>(
      "select id, coalesce(display_name, username::text) as name from users where active order by role = 'driver' desc, 2",
    ),
  ]);
  return (
    <AppShell user={user}>
      <TourPlanner initialTour={tour} initialStops={stops} drivers={drivers} mapStyle={mapStyleUrl()} />
    </AppShell>
  );
}
