import type { Metadata } from "next";
import { I18nProvider } from "@/components/I18nProvider";
import { brandColor, brandName, logoPath } from "@/lib/branding";
import { getLocale } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const fav = logoPath() ? "/branding/favicon.png" : undefined;
  return {
    title: brandName(),
    description: "Delivery planning, routing and tracking",
    robots: { index: false, follow: false },
    icons: fav ? { icon: fav } : undefined,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className="h-full antialiased" style={{ ["--accent" as string]: brandColor() }}>
      <body className="flex min-h-full flex-col">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
