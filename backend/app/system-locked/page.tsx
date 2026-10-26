import { redirect } from "next/navigation";
import { brandName } from "@/lib/branding";
import { envLockProblems } from "@/lib/env-check";
import { getT } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** Shown instead of every page while production secrets are insecure (see lib/env-check.ts). */
export default async function SystemLocked() {
  const problems = envLockProblems();
  if (!problems.length) redirect("/");
  const { t } = await getT();
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="card w-full max-w-xl space-y-4 border-[var(--danger)] p-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--danger)]">{brandName()}</p>
          <h1 className="text-xl font-semibold">{t("locked.title")}</h1>
        </div>
        <p className="text-sm">{t("locked.intro")}</p>
        <ul className="space-y-1 text-sm">
          {problems.map((p) => (
            <li key={p.variable} className="flex gap-2">
              <code className="rounded bg-[var(--bg-elevated)] px-1.5 font-mono text-xs">{p.variable}</code>
              <span className="text-[var(--text-secondary)]">{t(`locked.problem.${p.problem}`, { min: p.min ?? "" })}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-2 text-sm">
          <p>{t("locked.howto")}</p>
          <pre className="overflow-x-auto rounded-lg bg-[var(--bg-elevated)] p-3 text-xs">{`openssl rand -base64 48
# or: ./scripts/generate-env.sh
docker compose up -d`}</pre>
          <p className="text-[var(--text-secondary)]">{t("locked.inactive")}</p>
        </div>
      </div>
    </main>
  );
}
