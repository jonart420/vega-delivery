/**
 * Startup safety gate.
 *
 * In production (APP_ENV=production, the default when NODE_ENV=production) the backend refuses to
 * work while secrets still hold example values from .env.example, are empty or too weak. Every page
 * then shows /system-locked and every API answers 503 until .env is fixed and the container restarted.
 *
 * Pure function of process.env: safe to call from proxy.ts, instrumentation.ts and route handlers.
 */

export type EnvProblem = {
  variable: string;
  /** i18n key under "locked.problem.*" */
  problem: "missing" | "placeholder" | "too_short" | "weak" | "equals_username";
  min?: number;
};

/** Fragments that mark a value as copied from .env.example or as a well-known weak default. */
const PLACEHOLDER_FRAGMENTS = ["change-me", "changeme", "change_me", "replace-me", "example", "bitte-aendern", "your-"];
const WEAK_VALUES = new Set([
  "password", "passwort", "admin", "secret", "postgres", "root", "test", "123456", "12345678",
  "qwerty", "letmein", "welcome", "delivery", "vega",
]);

const MIN_PASSWORD = 16;
const MIN_SECRET_BYTES = 32;

export function isProduction(): boolean {
  const appEnv = (process.env.APP_ENV ?? "").toLowerCase();
  if (appEnv) return appEnv === "production";
  return process.env.NODE_ENV === "production";
}

function looksLikePlaceholder(v: string): boolean {
  const s = v.toLowerCase();
  return PLACEHOLDER_FRAGMENTS.some((f) => s.includes(f));
}

function checkPassword(variable: string, value: string | undefined, required: boolean, username?: string): EnvProblem | null {
  if (!value) return required ? { variable, problem: "missing" } : null;
  if (looksLikePlaceholder(value)) return { variable, problem: "placeholder" };
  if (WEAK_VALUES.has(value.toLowerCase())) return { variable, problem: "weak" };
  if (username && value.toLowerCase() === username.toLowerCase()) return { variable, problem: "equals_username" };
  if (value.length < MIN_PASSWORD) return { variable, problem: "too_short", min: MIN_PASSWORD };
  return null;
}

function checkSecret(variable: string, value: string | undefined, required: boolean): EnvProblem | null {
  if (!value) return required ? { variable, problem: "missing" } : null;
  if (looksLikePlaceholder(value)) return { variable, problem: "placeholder" };
  if (Buffer.byteLength(value, "utf8") < MIN_SECRET_BYTES) return { variable, problem: "too_short", min: MIN_SECRET_BYTES };
  return null;
}

/** Provider credentials: only checked for leftover placeholders (length is up to the provider). */
function checkToken(variable: string, value: string | undefined, required: boolean): EnvProblem | null {
  if (!value) return required ? { variable, problem: "missing" } : null;
  return looksLikePlaceholder(value) ? { variable, problem: "placeholder" } : null;
}

function dbPassword(): string | undefined {
  if (process.env.POSTGRES_PASSWORD) return process.env.POSTGRES_PASSWORD;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return url.password ? decodeURIComponent(url.password) : undefined;
  } catch {
    return undefined;
  }
}

/** All problems with the current environment, regardless of APP_ENV. */
export function collectEnvProblems(): EnvProblem[] {
  const env = process.env;
  const problems: (EnvProblem | null)[] = [
    checkPassword("POSTGRES_PASSWORD", dbPassword(), true, env.POSTGRES_USER),
    checkPassword("ADMIN_PASSWORD", env.ADMIN_PASSWORD, false, env.ADMIN_USERNAME),
    checkSecret("LOGIN_CODE_SECRET", env.LOGIN_CODE_SECRET, true),
  ];
  if (env.SMTP_HOST) problems.push(checkToken("SMTP_PASS", env.SMTP_PASS, false));
  const wa = (env.WHATSAPP_PROVIDER ?? "none").toLowerCase();
  if (wa === "meta") {
    problems.push(checkToken("WHATSAPP_META_TOKEN", env.WHATSAPP_META_TOKEN, true));
    problems.push(checkToken("WHATSAPP_META_PHONE_NUMBER_ID", env.WHATSAPP_META_PHONE_NUMBER_ID, true));
  } else if (wa === "twilio") {
    problems.push(checkToken("TWILIO_ACCOUNT_SID", env.TWILIO_ACCOUNT_SID, true));
    problems.push(checkToken("TWILIO_AUTH_TOKEN", env.TWILIO_AUTH_TOKEN, true));
  }
  if ((env.MAP_PROVIDER ?? "").toLowerCase() === "mapbox") problems.push(checkToken("MAPBOX_ACCESS_TOKEN", env.MAPBOX_ACCESS_TOKEN, true));
  return problems.filter((p): p is EnvProblem => p != null);
}

/** Problems that lock the system: only in production. */
export function envLockProblems(): EnvProblem[] {
  return isProduction() ? collectEnvProblems() : [];
}

export const systemLocked = () => envLockProblems().length > 0;
