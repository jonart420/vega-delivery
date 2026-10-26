import assert from "node:assert/strict";
import { test } from "node:test";
import { collectEnvProblems, envLockProblems } from "../lib/env-check";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    fn();
  } finally {
    process.env = saved;
  }
}

test("example values lock production", () => {
  withEnv(
    {
      APP_ENV: "production",
      POSTGRES_PASSWORD: "change-me-postgres-password",
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "change-me-admin-password",
      LOGIN_CODE_SECRET: "change-me-login-code-secret-at-least-32-bytes",
      WHATSAPP_PROVIDER: "none",
      SMTP_HOST: undefined,
    },
    () => {
      const vars = envLockProblems().map((p) => p.variable).sort();
      assert.deepEqual(vars, ["ADMIN_PASSWORD", "LOGIN_CODE_SECRET", "POSTGRES_PASSWORD"]);
    },
  );
});

test("strong values pass, development never locks", () => {
  const strong = {
    POSTGRES_PASSWORD: "v8Kq2pLx9zR4tW7mN3bH",
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "Tq9!xLm2#Rv7pZs4Kw",
    LOGIN_CODE_SECRET: "Zr2c7yQw1Hk9LmVb4Np8Xt6Ds3Fg5Jh0Ae2Ui7Oc",
    WHATSAPP_PROVIDER: "none",
    SMTP_HOST: undefined,
  };
  withEnv({ APP_ENV: "production", ...strong }, () => assert.deepEqual(collectEnvProblems(), []));
  withEnv({ APP_ENV: "development", POSTGRES_PASSWORD: "x", LOGIN_CODE_SECRET: "" }, () => assert.deepEqual(envLockProblems(), []));
});

test("short and weak passwords are rejected", () => {
  withEnv({ APP_ENV: "production", POSTGRES_PASSWORD: "postgres", ADMIN_PASSWORD: "short", LOGIN_CODE_SECRET: "x".repeat(10) }, () => {
    const byVar = Object.fromEntries(collectEnvProblems().map((p) => [p.variable, p.problem]));
    assert.equal(byVar.POSTGRES_PASSWORD, "weak");
    assert.equal(byVar.ADMIN_PASSWORD, "too_short");
    assert.equal(byVar.LOGIN_CODE_SECRET, "too_short");
  });
});
