"use client";

import { useI18n } from "@/components/I18nProvider";

export default function LogoutButton() {
  const { t } = useI18n();
  return (
    <button
      className="btn w-full"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        // Full reload: drops all client state of the signed-in session
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/login";
      }}
    >
      {t("nav.logout")}
    </button>
  );
}
