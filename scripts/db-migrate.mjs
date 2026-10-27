#!/usr/bin/env node
/**
 * Applies supabase/migrations to a real database and records each one, so it is always clear which files
 * production has. Until now migrations were pasted into the SQL editor by hand with no record.
 *
 *   DATABASE_URL=postgres://… npm run db:status                  # applied / pending / changed since applied
 *   DATABASE_URL=postgres://… npm run db:migrate                 # apply every pending file, in order
 *   DATABASE_URL=postgres://… npm run db:migrate -- --dry-run    # list what would run
 *   DATABASE_URL=postgres://… npm run db:baseline -- --through 038
 *       # one time, on a database where 001…038 were already run by hand: record them without running them
 *
 * DATABASE_URL: Supabase → Connect → "Session pooler" (or direct) connection string, with the database password.
 * Each file runs in its own transaction and is recorded in the same transaction, so a failure leaves nothing
 * half-applied and nothing recorded; the run stops at the first failure. On an empty database schema.sql runs
 * first. The record (file, SHA-256, time, who) lives in supabase_migrations.sokoglobal_applied, outside the
 * schemas the Data API exposes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const root = join(import.meta.dirname, '..');
const sb = join(root, 'supabase');
const FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;

const [command = 'status', ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const sha = (text) => createHash('sha256').update(text).digest('hex');

function migrationFiles() {
  const files = readdirSync(join(sb, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const bad = files.filter((f) => !FILE.test(f));
  if (bad.length) throw new Error(`Migration file names must look like 039_short_name.sql: ${bad.join(', ')}`);
  const seen = new Map();
  for (const f of files) {
    const n = f.slice(0, 3);
    if (seen.has(n)) throw new Error(`Two migrations share number ${n}: ${seen.get(n)} and ${f}`);
    seen.set(n, f);
  }
  return files.map((file) => { const sql = readFileSync(join(sb, 'migrations', file), 'utf8'); return { file, sql, sha: sha(sql) }; });
}

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (Supabase → Connect → Session pooler connection string).');
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const ca = process.env.PGSSLROOTCERT ? readFileSync(process.env.PGSSLROOTCERT, 'utf8') : undefined;
  // Supabase requires TLS. With PGSSLROOTCERT (Supabase → Database settings → SSL certificate) the server is verified too.
  return new pg.Client({ connectionString: url, ssl: local ? false : ca ? { ca } : { rejectUnauthorized: false }, application_name: 'sokoglobal-db-migrate' });
}

const LEDGER = 'supabase_migrations.sokoglobal_applied';
async function ensureLedger(db) {
  await db.query(`
    create schema if not exists supabase_migrations;
    create table if not exists ${LEDGER} (
      file       text primary key,
      sha256     text not null,
      applied_at timestamptz not null default now(),
      applied_by text not null,
      baseline   boolean not null default false
    );
    do $$ begin
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on ${LEDGER} from anon, authenticated';
      end if;
    end $$;`);
}

async function ledger(db) {
  const { rows } = await db.query(`select file, sha256, applied_at, baseline from ${LEDGER}`);
  return new Map(rows.map((r) => [r.file, r]));
}

const who = () => process.env.GITHUB_ACTOR || process.env.USER || (() => { try { return userInfo().username; } catch { return 'unknown'; } })();

async function applyFile(db, file, sql, digest) {
  await db.query('begin');
  try {
    await db.query(sql);
    await db.query(`insert into ${LEDGER} (file, sha256, applied_by) values ($1, $2, $3)
                    on conflict (file) do update set sha256 = excluded.sha256, applied_at = now(), applied_by = excluded.applied_by, baseline = false`,
      [file, digest, who()]);
    await db.query('commit');
  } catch (err) {
    await db.query('rollback').catch(() => undefined);
    throw new Error(`${file} failed and was rolled back: ${err.message}`);
  }
}

async function main() {
  const files = migrationFiles();
  if (command === 'check') { console.log(`✔ ${files.length} migration files, numbered ${files[0].file.slice(0, 3)}…${files.at(-1).file.slice(0, 3)}, no duplicates`); return; }

  const db = connect();
  await db.connect();
  try {
    await ensureLedger(db);
    const applied = await ledger(db);
    const { rows: [{ has_schema: hasSchema }] } = await db.query(`select to_regclass('public.profiles') is not null as has_schema`);

    if (command === 'status') {
      if (hasSchema && applied.size === 0) console.log('! This database has the SokoGlobal schema but no migration record. Run db:baseline once (see --help in the script).');
      let pending = 0;
      for (const m of files) {
        const row = applied.get(m.file);
        const state = !row ? 'pending' : row.sha256 !== m.sha ? 'CHANGED since applied' : row.baseline ? 'applied (baseline)' : 'applied';
        if (!row) pending += 1;
        console.log(`${row ? (row.sha256 === m.sha ? '✔' : '!') : '·'} ${m.file.padEnd(48)} ${state}${row ? `  ${new Date(row.applied_at).toISOString().slice(0, 16)}` : ''}`);
      }
      console.log(`\n${pending} pending.`);
      return;
    }

    if (command === 'baseline') {
      const through = option('--through');
      if (!through || !/^\d{3}$/.test(through)) throw new Error('Pass --through NNN: the last migration already run on this database by hand (e.g. --through 038).');
      if (!hasSchema) throw new Error('This database has no SokoGlobal schema; use db:migrate instead of a baseline.');
      const marked = files.filter((m) => m.file.slice(0, 3) <= through && !applied.has(m.file));
      for (const m of marked) {
        await db.query(`insert into ${LEDGER} (file, sha256, applied_by, baseline) values ($1, $2, $3, true)`, [m.file, m.sha, who()]);
      }
      console.log(`✔ recorded ${marked.length} file(s) through ${through} as already applied (not run).`);
      return;
    }

    if (command === 'up') {
      if (hasSchema && applied.size === 0) {
        throw new Error('This database already has the SokoGlobal schema but no migration record. Run `npm run db:baseline -- --through NNN` first, with NNN = the last migration you ran by hand.');
      }
      const pending = files.filter((m) => !applied.has(m.file));
      const changed = files.filter((m) => applied.get(m.file) && applied.get(m.file).sha256 !== m.sha);
      if (changed.length) console.log(`! changed since applied (not re-run): ${changed.map((m) => m.file).join(', ')}`);
      if (flag('--dry-run')) {
        if (!hasSchema) console.log('· schema.sql (empty database)');
        for (const m of pending) console.log(`· ${m.file}`);
        console.log(`${pending.length} file(s) would run.`);
        return;
      }
      if (!hasSchema) {
        const schema = readFileSync(join(sb, 'schema.sql'), 'utf8');
        await applyFile(db, 'schema.sql', schema, sha(schema));
        console.log('✔ schema.sql');
      }
      for (const m of pending) {
        await applyFile(db, m.file, m.sql, m.sha);
        console.log(`✔ ${m.file}`);
      }
      console.log(pending.length ? `\n${pending.length} migration(s) applied.` : 'Up to date: nothing to apply.');
      return;
    }

    throw new Error(`Unknown command "${command}". Use status, up, baseline or check.`);
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
