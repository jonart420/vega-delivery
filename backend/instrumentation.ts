export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { envLockProblems } = await import("./lib/env-check");
  const problems = envLockProblems();
  if (problems.length) {
    // System stays inactive (see proxy.ts) until .env is fixed and the container restarted.
    console.error(
      "\n[security] ════════════════════════════════════════════════════════════\n" +
        "[security] SYSTEM LOCKED: insecure configuration in production.\n" +
        problems.map((p) => `[security]   ${p.variable}: ${p.problem}${p.min ? ` (min. ${p.min})` : ""}`).join("\n") +
        "\n[security] Use strong, unique values (e.g. openssl rand -base64 48) and restart.\n" +
        "[security] ════════════════════════════════════════════════════════════\n",
    );
    return;
  }
  const { runMigrations, bootstrapAdmin } = await import("./lib/migrate");
  try {
    await runMigrations();
    await bootstrapAdmin();
  } catch (e) {
    console.error("[start] migration/bootstrap failed:", e);
  }
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { startNotifyWorker } = await import("./lib/notify-worker");
    startNotifyWorker();
  }
}
