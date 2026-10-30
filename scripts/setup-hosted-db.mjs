// One-time setup on a shared hosted Postgres (e.g. Supabase): creates the `signalroom`
// schema and a least-privilege role that owns only that schema. Prints nothing secret.
// Usage: ADMIN_DATABASE_URL=... node scripts/setup-hosted-db.mjs   (writes .env.hosted)
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const { Client } = createRequire(import.meta.url)("../api/node_modules/pg");

const adminUrl = process.env.ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error("Set ADMIN_DATABASE_URL");
const admin = new Client({ connectionString: adminUrl, ssl: { rejectUnauthorized: false } });
await admin.connect();
const password = randomBytes(24).toString("base64url");
await admin.query(`
  create extension if not exists vector with schema extensions;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'signalroom_app') then
      create role signalroom_app login;
    end if;
  end $$;
  grant signalroom_app to current_user;  -- PG16: needed to hand it the schema
  create schema if not exists signalroom authorization signalroom_app;
  revoke all on schema public from signalroom_app;
  grant usage on schema extensions to signalroom_app;
  alter role signalroom_app set search_path = signalroom, extensions;
  alter role signalroom_app password '${password}';
`);
await admin.end();

// Session pooler (port 5432): long-running services, advisory locks and prepared statements work.
const u = new URL(adminUrl);
const ref = decodeURIComponent(u.username).split(".")[1];
u.username = ref ? `signalroom_app.${ref}` : "signalroom_app";
u.password = password;
u.port = "5432";
writeFileSync(new URL("../.env.hosted", import.meta.url), `DATABASE_URL=${u}\n`, { mode: 0o600 });
console.error("wrote .env.hosted");
