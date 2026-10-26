import AppShell from "../AppShell";
import { requireUser } from "@/lib/auth";
import { listTeam, loginCodeConfigProblem, redactForViewer } from "@/lib/login-code";
import TeamClient from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await requireUser();
  const members = redactForViewer(await listTeam(), user);
  return (
    <AppShell user={user}>
      <TeamClient members={members} isAdmin={user.role === "admin"} viewerId={user.id} configError={loginCodeConfigProblem()} />
    </AppShell>
  );
}
