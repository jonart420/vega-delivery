import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { brandColor, brandName, logoPath } from "@/lib/branding";
import { mapStyleUrl } from "@/lib/map";
import { getLocale, isLocale, makeT } from "@/lib/i18n";
import { getSetting } from "@/lib/settings";
import { publicTracking } from "@/lib/tracking";
import TrackingView from "./TrackingView";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: brandName(), robots: { index: false, follow: false } };
}

/** Public tracking page for customers (no login). Language: customer setting → browser. */
export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await publicTracking(token);
  if (!data) notFound();
  const locale = isLocale(data.locale) ? data.locale : await getLocale();
  const company = await getSetting("company");
  const t = makeT(locale);
  return (
    <TrackingView
      token={token}
      initial={data}
      locale={locale}
      brand={{ name: company.name || brandName(), color: brandColor(), logo: logoPath(), phone: company.phone }}
      mapStyle={mapStyleUrl()}
      title={t("tracking.title")}
    />
  );
}
