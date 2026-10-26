import { NextResponse } from "next/server";
import { appUser } from "@/lib/app-auth";
import { appTourAccess } from "@/lib/app-tours";
import { trackingUrl } from "@/lib/notify";
import { getStops, getTour } from "@/lib/tours";

export const dynamic = "force-dynamic";

/** Complete offline package of a tour for the app (stops in driving order, orders, items, route). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const access = await appTourAccess(id, user.id);
  if (access instanceof NextResponse) return access;
  const [tour, stops] = await Promise.all([getTour(id), getStops(id)]);
  if (!tour) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    tour: {
      id: tour.id,
      date: tour.date,
      title: tour.title,
      vehicle: tour.vehicle,
      mode: tour.mode,
      status: tour.status,
      planned_start: tour.planned_start,
      start: tour.start_lat != null ? { lat: tour.start_lat, lon: tour.start_lon, label: tour.start_label } : null,
      end: tour.end_lat != null ? { lat: tour.end_lat, lon: tour.end_lon, label: tour.end_label } : null,
      route: tour.route,
    },
    stops: stops.map((s) => ({
      id: s.id,
      position: s.sort_index,
      status: s.status,
      outcome_code: s.outcome_code,
      eta: s.eta,
      customer_id: s.customer_id,
      customer_no: s.customer_no,
      name: s.name,
      company: s.company,
      first_name: s.first_name,
      last_name: s.last_name,
      street: s.street,
      house_no: s.house_no,
      address_extra: s.address_extra,
      zip: s.zip,
      city: s.city,
      country: s.country,
      lat: s.lat,
      lon: s.lon,
      phone: s.phone,
      whatsapp: s.whatsapp,
      delivery_notes: s.delivery_notes,
      time_window_from: s.time_window_from,
      time_window_to: s.time_window_to,
      tracking_url: trackingUrl(s.tracking_token),
      orders: s.orders,
    })),
  });
}
