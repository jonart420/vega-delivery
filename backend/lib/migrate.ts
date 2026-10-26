import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db";
import { hashPassword } from "./password";

/** Last error while applying migrations (for /api/health). Global because instrumentation
 *  and route handlers are bundled separately and would otherwise each have their own copy. */
const state = globalThis as unknown as { __vdMigrationError?: string | null };
export const migrationError = () => state.__vdMigrationError ?? null;

/** Applies new SQL files from db/migrations (alphabetically, each once). */
export async function runMigrations() {
  state.__vdMigrationError = null;
  try {
    await applyMigrations();
  } catch (e) {
    state.__vdMigrationError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

async function applyMigrations() {
  const dir = path.join(process.cwd(), "db", "migrations");
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(727272)");
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(name) values ($1)", [f]);
        await client.query("commit");
        console.log(`[migrate] applied ${f}`);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`${f}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(727272)").catch(() => {});
    client.release();
  }
}

/** Creates the first admin from ADMIN_USERNAME / ADMIN_PASSWORD, only while no admin exists. */
export async function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  const { rows } = await pool.query("select 1 from users where role = 'admin' limit 1");
  if (rows.length) return;
  await pool.query(
    "insert into users (username, display_name, password_hash, role) values ($1, $2, $3, 'admin') on conflict (username) do nothing",
    [username, username, await hashPassword(password)],
  );
  console.log(`[bootstrap] created admin "${username}"`);
}
