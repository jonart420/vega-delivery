import AppShell from "../AppShell";
import { requireStaff } from "@/lib/auth";
import { notifyStatus } from "@/lib/notify";
import { DEFAULT_TEMPLATES } from "@/lib/notify/templates";
import { listOutcomes, listReasons } from "@/lib/outcomes";
import { getSettings } from "@/lib/settings";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireStaff();
  const [settings, outcomes, reasons] = await Promise.all([getSettings(), listOutcomes(), listReasons()]);
  const { tab } = await searchParams;
  return (
    <AppShell user={user}>
      <SettingsClient
        initialTab={tab ?? "general"}
        isAdmin={user.role === "admin"}
        settings={settings}
        outcomes={outcomes}
        reasons={reasons}
        channels={notifyStatus()}
        defaultTemplates={DEFAULT_TEMPLATES}
      />
    </AppShell>
  );
}
