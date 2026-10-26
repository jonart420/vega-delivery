import { isStaff, type SessionUser } from "@/lib/auth";
import { brandName, logoPath } from "@/lib/branding";
import { getT } from "@/lib/i18n";
import Sidebar, { type NavGroup } from "./Sidebar";

/** Layout for all protected pages: vertical navigation with collapsible groups. */
export default async function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const { t, locale } = await getT();
  const staff = isStaff(user);
  const groups: NavGroup[] = staff
    ? [
        { id: "overview", label: t("nav.dashboard"), icon: "▦", href: "/", exact: true },
        {
          id: "dispatch",
          label: t("nav.group_dispatch"),
          icon: "⇄",
          items: [
            { href: "/tours", label: t("nav.tours") },
            { href: "/orders", label: t("nav.orders") },
            { href: "/orders/new", label: t("orders.new"), exact: true },
          ],
        },
        {
          id: "master",
          label: t("nav.group_master"),
          icon: "☰",
          items: [
            { href: "/customers", label: t("nav.customers") },
            { href: "/customers/new", label: t("customers.new"), exact: true },
            { href: "/products", label: t("nav.products") },
          ],
        },
        {
          id: "admin",
          label: t("nav.group_admin"),
          icon: "⚙",
          items: [
            { href: "/team", label: t("nav.team") },
            { href: "/settings?tab=general", label: t("settings.tab_general"), match: "/settings", tab: "general" },
            { href: "/settings?tab=outcomes", label: t("settings.tab_outcomes"), match: "/settings", tab: "outcomes" },
            { href: "/settings?tab=notifications", label: t("settings.tab_notifications"), match: "/settings", tab: "notifications" },
            { href: "/settings?tab=barcodes", label: t("settings.tab_barcodes"), match: "/settings", tab: "barcodes" },
          ],
        },
      ]
    : [{ id: "team", label: t("nav.team"), icon: "☺", href: "/team" }];

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <Sidebar
        groups={groups}
        brand={brandName()}
        logo={logoPath()}
        locale={locale}
        userName={user.display_name || user.username}
        role={t(`roles.${user.role}`)}
        labels={{ menu: t("nav.menu"), logout: t("nav.logout") }}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}
