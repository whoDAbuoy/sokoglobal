#!/usr/bin/env node
/**
 * Database integration tests (needs Docker): starts a throwaway postgres:15,
 * loads supabase/tests/supabase-stubs.sql, applies schema.sql and every
 * migration in order (each in one transaction, like `supabase db push`),
 * re-applies the recent migrations a SECOND time (from DB_TEST_REPLAY_FROM,
 * default 021: they must be re-runnable on a database that already has every
 * later file — this catches 42P13 "cannot change return type" when an earlier
 * file redefines a function a later one changed), then runs every
 * supabase/tests/*.test.sql against the replayed schema. The container is always removed.
 *
 *   npm run test:db
 *   DB_TEST_REPLAY_FROM=002 DB_TEST_REPLAY_REPORT=1 npm run test:db   # list which older files are not re-runnable
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const sb = join(root, 'supabase');
const name = `sokoglobal-dbtest-${process.pid}`;
const image = process.env.DB_TEST_IMAGE || 'postgres:15-alpine';

const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const psql = (label, sql, { quiet = true } = {}) => {
  const r = docker(['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '--single-transaction', ...(quiet ? ['-q'] : []), '-f', '-'], sql);
  if (r.status !== 0) {
    console.error(`✖ ${label}\n${(r.stderr || r.stdout).split('\n').filter((l) => !/NOTICE|wal_level|HINT/.test(l)).join('\n')}`);
    throw new Error(`${label} failed`);
  }
  return r;
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let exit = 0;
try {
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=pg', image]);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  // pg_isready can pass during the image's init restart; wait until a query succeeds twice.
  for (let i = 0, ok = 0; ok < 2; i += 1) {
    if (i > 60) throw new Error('postgres did not start');
    ok = docker(['exec', name, 'psql', '-U', 'postgres', '-c', 'select 1']).status === 0 ? ok + 1 : 0;
    sleep(500);
  }

  psql('supabase stubs', readFileSync(join(sb, 'tests', 'supabase-stubs.sql'), 'utf8'));
  // schema.sql creates pgcrypto in public; Supabase keeps it in "extensions" (already created by the stubs).
  psql('schema.sql', readFileSync(join(sb, 'schema.sql'), 'utf8').replace(/create extension if not exists "pgcrypto";/i, ''));
  const migrations = readdirSync(join(sb, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  const migrationSql = (f) => readFileSync(join(sb, 'migrations', f), 'utf8').replace(/^create extension if not exists supabase_vault.*$/im, '');
  for (const f of migrations) {
    psql(f, migrationSql(f));
    console.log(`✔ ${f}`);
  }
  const replayFrom = process.env.DB_TEST_REPLAY_FROM ?? '021';
  const replay = migrations.filter((f) => f >= replayFrom);
  const report = process.env.DB_TEST_REPLAY_REPORT === '1';
  const notReplayable = [];
  for (const f of replay) {
    try { psql(`re-run of ${f}`, migrationSql(f)); } catch (err) { if (!report) throw err; notReplayable.push(f); }
  }
  if (report) {
    console.log(notReplayable.length ? `✖ not re-runnable: ${notReplayable.join(', ')}` : `✔ all ${replay.length} re-run cleanly`);
    process.exitCode = notReplayable.length ? 1 : 0;
    throw new Error('replay report only (tests skipped)');
  }
  console.log(`✔ re-ran ${replay[0] ?? '-'}…${replay.at(-1) ?? '-'} (${replay.length} files) on the full schema`);
  for (const f of readdirSync(join(sb, 'tests')).filter((f) => f.endsWith('.test.sql')).sort()) {
    const r = psql(f, readFileSync(join(sb, 'tests', f), 'utf8'), { quiet: false });
    const passes = (r.stderr.match(/NOTICE: {2}pass/g) ?? []).length;
    console.log(`✔ ${f} (${passes} checks)`);
  }
  console.log('\nDatabase tests passed.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exit = 1;
} finally {
  docker(['rm', '-f', name]);
}
process.exit(exit);
