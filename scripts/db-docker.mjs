/**
 * A throwaway postgres:15 container with the Supabase stand-ins (supabase/tests/supabase-stubs.sql),
 * schema.sql and every migration applied in order, each in one transaction like `supabase db push`.
 * Shared by scripts/db-test.mjs and scripts/db-types.mjs. Needs Docker.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const sb = join(import.meta.dirname, '..', 'supabase');
const image = process.env.DB_TEST_IMAGE || 'postgres:15-alpine';

export const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export const migrations = readdirSync(join(sb, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
export const migrationSql = (f) => readFileSync(join(sb, 'migrations', f), 'utf8').replace(/^create extension if not exists supabase_vault.*$/im, '');
export const testFiles = readdirSync(join(sb, 'tests')).filter((f) => f.endsWith('.test.sql')).sort();
export const testSql = (f) => readFileSync(join(sb, 'tests', f), 'utf8');

/** Starts the container (`port` publishes 5432 on the host) and waits until it answers queries. */
export function startDb(name, { port } = {}) {
  const run = docker(['run', '-d', '--rm', '--name', name, ...(port ? ['-p', `${port}:5432`] : []), '-e', 'POSTGRES_PASSWORD=pg', image]);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
  // pg_isready can pass during the image's init restart; wait until a query succeeds twice.
  for (let i = 0, ok = 0; ok < 2; i += 1) {
    if (i > 60) throw new Error('postgres did not start');
    ok = docker(['exec', name, 'psql', '-U', 'postgres', '-c', 'select 1']).status === 0 ? ok + 1 : 0;
    sleep(500);
  }

  const psql = (label, sql, { quiet = true } = {}) => {
    const r = docker(['exec', '-i', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '--single-transaction', ...(quiet ? ['-q'] : []), '-f', '-'], sql);
    if (r.status !== 0) {
      console.error(`✖ ${label}\n${(r.stderr || r.stdout).split('\n').filter((l) => !/NOTICE|wal_level|HINT/.test(l)).join('\n')}`);
      throw new Error(`${label} failed`);
    }
    return r;
  };

  /** Stubs, schema.sql, then every migration; `onFile` is called after each migration. */
  const applySchema = (onFile = () => {}) => {
    psql('supabase stubs', readFileSync(join(sb, 'tests', 'supabase-stubs.sql'), 'utf8'));
    // schema.sql creates pgcrypto in public; Supabase keeps it in "extensions" (already created by the stubs).
    psql('schema.sql', readFileSync(join(sb, 'schema.sql'), 'utf8').replace(/create extension if not exists "pgcrypto";/i, ''));
    for (const f of migrations) {
      psql(f, migrationSql(f));
      onFile(f);
    }
  };

  return { psql, applySchema, remove: () => docker(['rm', '-f', name]) };
}
