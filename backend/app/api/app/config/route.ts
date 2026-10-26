import { NextResponse } from "next/server";
import { appUser } from "@/lib/app-auth";
import { brandColor, brandName, logoPath, publicBaseUrl } from "@/lib/branding";
import { mapAttribution, mapProvider, mapStyleUrl } from "@/lib/map";
import { listOutcomes, listReasons } from "@/lib/outcomes";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Everything the driver app needs besides tours: branding, map style, delivery outcomes with their
 * required proofs and reasons (both freely extensible in the backend).
 */
export async function GET(req: Request) {
  const user = await appUser(req);
  if (user instanceof NextResponse) return user;
  const [outcomes, reasons, settings] = await Promise.all([listOutcomes(true), listReasons(true), getSettings()]);
  const logo = logoPath();
  return NextResponse.json({
    brand: { name: brandName(), color: brandColor(), logo_url: logo ? publicBaseUrl() + logo : null },
    company: settings.company,
    map: { provider: mapProvider(), style_url: mapStyleUrl(true), attribution: mapAttribution() },
    map_style_url: mapStyleUrl(true),
    notify_lead_stops: settings.notifications.lead_stops,
    outcomes: outcomes.map((o) => ({ ...o, reasons: reasons.filter((r) => r.outcome_code === o.code) })),
  });
}
