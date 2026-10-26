import Link from "next/link";
import AppShell from "./AppShell";
import { requireStaff } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { envLockProblems } from "@/lib/env-check";
import { getT, intlLocale } from "@/lib/i18n";
import { notifyStatus } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { listTours, tz } from "@/lib/tours";
import TourStatusBadge from "@/components/TourStatusBadge";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireStaff();
  const { t, locale } = await getT();
  const today = (await q1<{ d: string }>("select to_char((now() at time zone $1)::date, 'YYYY-MM-DD') as d", [tz()]))!.d;
  const [tours, counts, settings] = await Promise.all([
    listTours({ from: today, to: today }),
    q1<{ unplanned_today: number; unplanned_next: number; failed_today: number; notif_failed: number }>(
      `select
         (select count(*)::int from orders o where o.delivery_date = $1 and o.status = 'open') as unplanned_today,
         (select count(*)::int from orders o where o.delivery_date > $1 and o.delivery_date <= $1::date + 7 and o.status = 'open') as unplanned_next,
         (select count(*)::int from tour_stops s join tours t on t.id = s.tour_id where t.date = $1 and s.status in ('failed', 'skipped')) as failed_today,
         (select count(*)::int from notifications n where n.status = 'failed' and n.created_at > now() - interval '2 days') as notif_failed`,
      [today],
    ),
    getSettings(),
  ]);
  const recent = await q<{ id: string; occurred_at: Date; outcome: string | null; kind: string | null; customer: string; tour: string }>(
    `select e.id, e.occurred_at, case when $1 = 'de' then o.label_de else o.label_en end as outcome, o.kind,
            concat_ws(' - ', nullif(concat_ws(' ', c.first_name, c.last_name), ''), c.company) as customer, t.title as tour
       from delivery_events e join tours t on t.id = e.tour_id
       left join delivery_outcomes o on o.code = e.outcome_code left join customers c on c.id = e.customer_id
      where e.type = 'outcome' order by e.occurred_at desc limit 12`,
    [locale],
  );
  const channels = notifyStatus();
  const setupHints = [
    !settings.depot.lat && { href: "/settings", text: t("dashboard.hint_depot") },
    !settings.company.name && { href: "/settings", text: t("dashboard.hint_company") },
    !channels.email && !channels.whatsapp && { href: "/settings?tab=notifications", text: t("dashboard.hint_channels") },
    envLockProblems().length === 0 && process.env.APP_ENV === "development" && { href: "#", text: t("dashboard.hint_dev_mode") },
  ].filter(Boolean) as { href: string; text: string }[];
  const fmtTime = (d: Date) => d.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit", timeZone: tz() });

  return (
    <AppShell user={user}>
      <main className="page">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="page-title">{t("dashboard.title")}</h1>
          <span className="muted text-sm">
            {new Date(`${today}T12:00:00Z`).toLocaleDateString(intlLocale(locale), { dateStyle: "full" })}
          </span>
        </div>
        {setupHints.length > 0 && (
          <div className="alert space-y-1">
            {setupHints.map((h) => (
              <Link key={h.text} href={h.href} className="block hover:underline">
                → {h.text}
              </Link>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("dashboard.unplanned_today")} value={counts?.unplanned_today ?? 0} href={`/orders?date=${today}&status=open`} warn />
          <Stat label={t("dashboard.unplanned_next")} value={counts?.unplanned_next ?? 0} href="/orders?status=open" />
          <Stat label={t("dashboard.failed_today")} value={counts?.failed_today ?? 0} href="/tours" warn />
          <Stat label={t("dashboard.notifications_failed")} value={counts?.notif_failed ?? 0} href="/tours" warn />
        </div>

        <section className="card">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <h2 className="font-medium">{t("dashboard.tours_today")}</h2>
            <Link href="/tours" className="btn btn-sm">{t("dashboard.all_tours")}</Link>
          </div>
          {tours.length === 0 ? (
            <p className="muted p-4 text-sm">{t("dashboard.no_tours")}</p>
          ) : (
            <table className="table">
              <tbody>
                {tours.map((tour) => {
                  const done = tour.done_count + tour.failed_count;
                  const pct = tour.stop_count ? Math.round((done / tour.stop_count) * 100) : 0;
                  return (
                    <tr key={tour.id}>
                      <td>
                        <Link href={`/tours/${tour.id}`} className="font-medium hover:underline">{tour.title}</Link>
                        <div className="muted text-xs">{tour.driver_name ?? t("tours.no_driver")}</div>
                      </td>
                      <td><TourStatusBadge status={tour.status} /></td>
                      <td className="w-1/3">
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                          <div className="h-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="muted mt-1 text-xs">
                          {t("dashboard.progress", { done, total: tour.stop_count, failed: tour.failed_count })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <h2 className="border-b border-[var(--border)] px-4 py-3 font-medium">{t("dashboard.recent_events")}</h2>
          {recent.length === 0 ? (
            <p className="muted p-4 text-sm">{t("dashboard.no_events")}</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)] text-sm">
              {recent.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="muted w-12 tabular-nums">{fmtTime(e.occurred_at)}</span>
                  <span className={`badge ${e.kind === "success" ? "badge-success" : e.kind === "failure" ? "badge-danger" : ""}`}>{e.outcome}</span>
                  <span className="min-w-0 flex-1 truncate">{e.customer}</span>
                  <span className="muted text-xs">{e.tour}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function Stat({ label, value, href, warn }: { label: string; value: number; href: string; warn?: boolean }) {
  return (
    <Link href={href} className="card block p-4 hover:bg-[var(--bg-elevated)]">
      <div className={`text-2xl font-semibold tabular-nums ${warn && value > 0 ? "text-[var(--warning)]" : ""}`}>{value}</div>
      <div className="muted text-xs">{label}</div>
    </Link>
  );
}
