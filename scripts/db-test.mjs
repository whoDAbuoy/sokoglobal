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
import { migrations, migrationSql, startDb, testFiles, testSql } from './db-docker.mjs';

const name = `sokoglobal-dbtest-${process.pid}`;

let exit = 0;
let db;
try {
  db = startDb(name);
  const { psql } = db;
  db.applySchema((f) => console.log(`✔ ${f}`));
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
  for (const f of testFiles) {
    const r = psql(f, testSql(f), { quiet: false });
    const passes = (r.stderr.match(/NOTICE: {2}pass/g) ?? []).length;
    console.log(`✔ ${f} (${passes} checks)`);
  }
  console.log('\nDatabase tests passed.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exit = 1;
} finally {
  db?.remove();
}
process.exit(exit);
