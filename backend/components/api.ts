"use client";

/** fetch wrapper for the backend API: JSON in/out, throws Error(message) on failure. */
export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export const euro = (cents: number, intl: string) =>
  (cents / 100).toLocaleString(intl, { style: "currency", currency: process.env.NEXT_PUBLIC_CURRENCY || "EUR" });
