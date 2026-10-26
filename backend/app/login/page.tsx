import { brandName, logoPath } from "@/lib/branding";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm brand={brandName()} logo={logoPath()} />;
}
