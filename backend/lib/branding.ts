import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Branding and public configuration.
 *
 * Logos live in a folder that is mounted at runtime (BRANDING_DIR, in Docker /app/public/branding,
 * fed from <repo>/branding). Next.js standalone only serves public/ files that existed at build
 * time, so app/branding/[file]/route.ts serves this folder itself.
 */

export const BRANDING_FILES = ["logo.svg", "logo.png", "logo-dark.svg", "logo-dark.png", "favicon.png", "favicon.ico", "favicon.svg"] as const;

export function brandingDir(): string {
  // Docker: BRANDING_DIR=/app/public/branding (mounted). `npm run dev`: <repo>/branding.
  return path.resolve(process.cwd(), process.env.BRANDING_DIR || "../branding");
}

export const brandName = () => process.env.BRAND_NAME?.trim() || "VEGA Delivery";

/** Accent colour (#rrggbb). */
export function brandColor(): string {
  const c = process.env.BRAND_COLOR?.trim() ?? "";
  return /^#[0-9a-f]{6}$/i.test(c) ? c : "#2563eb";
}

/** Public base URL used in tracking links, e-mails and the app QR code. */
export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.BACKEND_PORT || 3100}`).replace(/\/$/, "");
}

/** Path of the logo (svg preferred) relative to the site, or null. */
export function logoPath(dark = false): string | null {
  const dir = brandingDir();
  const order = dark ? ["logo-dark.svg", "logo-dark.png", "logo.svg", "logo.png"] : ["logo.svg", "logo.png"];
  const hit = order.find((f) => existsSync(path.join(dir, f)));
  return hit ? `/branding/${hit}` : null;
}

export function logoFile(): string | null {
  const dir = brandingDir();
  const hit = ["logo.png", "logo.svg"].find((f) => existsSync(path.join(dir, f)));
  return hit ? path.join(dir, hit) : null;
}
