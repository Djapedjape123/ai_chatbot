// PGlite (Postgres u WASM-u) kao lokalna zamena za Supabase bazu: osnova + sve migracije redom + SQL testovi.
// Dokazuje ponašanje SQL-a (RLS, grantovi, okidači, funkcije). NE dokazuje ono što zavisi od pravog Supabase-a
// (vidi tools/verify/README.md, "SQL harness"). Migracije i testovi se čitaju iz supabase/ i NIKAD se ne menjaju na disku:
// namerne greške (mutacije) se prave u memoriji i prosleđuju kao `overrides`.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..', '..');
export const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
export const testsDir = path.join(repoRoot, 'supabase', 'tests');
const baselineFile = path.resolve(here, '..', 'sql', 'baseline.sql');

// Radna kopija na Windows-u može biti CRLF (git autocrlf), indeks je LF: čita se uvek kao LF da bi mutacije (zamena teksta) radile isto svuda.
const readLf = (file) => readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

export function listMigrations() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readLf(path.join(migrationsDir, f)) }));
}

export function listTests() {
  return readdirSync(testsDir)
    .filter((f) => f.endsWith('_test.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readLf(path.join(testsDir, f)) }));
}

// pg_cron ne postoji u PGlite-u (zamena je u osnovi). Migracija 2 uključuje ekstenziju i daje prava nad šemom cron;
// te tri naredbe se izbacuju. Ako ih nema (migracija je izmenjena), harness staje: tiho preskakanje bi sakrilo razliku.
const CRON_LINES = [
  'create extension if not exists pg_cron with schema pg_catalog;',
  'grant usage on schema cron to postgres;',
  'grant all privileges on all tables in schema cron to postgres;',
];

export function prepareForPglite(name, sql) {
  if (!name.includes('phase2_usage_audit')) return sql;
  let out = sql;
  for (const line of CRON_LINES) {
    if (!out.includes(line)) {
      throw new Error(`harness: u ${name} nema očekivane naredbe za pg_cron: ${line}`);
    }
    out = out.replace(line, () => '-- (harness: izbačeno, PGlite nema pg_cron) ' + line);
  }
  return out;
}

export async function createDb(loadDataDir) {
  return PGlite.create({ extensions: { vector }, ...(loadDataDir ? { loadDataDir } : {}) });
}

async function rollbackQuietly(db) {
  try {
    await db.exec('rollback');
  } catch {
    // nema otvorene transakcije
  }
}

export async function applyBaseline(db) {
  await db.exec(readFileSync(baselineFile, 'utf8'));
}

// `overrides`: { [imeMigracije]: izmenjenSql } za namerne greške. Vraća spisak primenjenih imena.
export async function applyMigrations(db, { upto, only, overrides = {} } = {}) {
  const applied = [];
  for (const m of listMigrations()) {
    if (upto && m.name.slice(0, upto.length) > upto) break;
    if (only && !only.includes(m.name)) continue;
    const sql = prepareForPglite(m.name, overrides[m.name] ?? m.sql);
    try {
      await db.exec(sql);
    } catch (e) {
      await rollbackQuietly(db);
      throw new Error(`migracija ${m.name} nije prošla: ${e.message}`);
    }
    applied.push(m.name);
  }
  return applied;
}

// Pokreće jedan SQL test (ceo fajl u jednom exec-u; fajl sam otvara i poništava transakciju).
// Uspeh = nema greške I postoji red `rezultat` (tihi rani izlaz se ne sme smatrati prolazom).
//
// Upozorenja baze se broje: okidač private.audit_mfa_removed() namerno guta grešku upisa (da audit ne blokira uklanjanje
// faktora), pa bi bez brojanja svaki neočekivan pad tog upisa (npr. FK pri brisanju naloga) prošao nezapaženo.
// phase2511 test jednom namerno obara upis (odeljak 14); svuda drugde očekivano je 0.
const WATCHED_WARNING = 'audit mfa_removed nije upisan';
const EXPECTED_WARNINGS = { 'phase2511_hard_rls_test.sql': 1 };

export async function runSqlTest(db, test) {
  try {
    const notices = [];
    const results = await db.exec(test.sql, { onNotice: (n) => notices.push(String(n.message)) });
    const rows = results.flatMap((r) => (r.fields ?? []).some((f) => f.name === 'rezultat') ? r.rows : []);
    if (rows.length === 0) {
      return { ok: false, message: 'test se završio bez reda "rezultat"' };
    }
    const text = rows.map((r) => String(r.rezultat)).join(' | ');
    const warned = notices.filter((m) => m.includes(WATCHED_WARNING)).length;
    const expected = EXPECTED_WARNINGS[test.name] ?? 0;
    if (warned !== expected) {
      return { ok: false, message: `${text}, ali upozorenja "${WATCHED_WARNING}": ${warned} (očekivano ${expected})` };
    }
    return { ok: /prošli/.test(text), message: text };
  } catch (e) {
    await rollbackQuietly(db);
    return { ok: false, message: String(e.message).split('\n')[0] };
  }
}

export async function runAllTests(db, { names } = {}) {
  const out = [];
  for (const t of listTests()) {
    if (names && !names.some((n) => t.name.includes(n))) continue;
    out.push({ name: t.name, ...(await runSqlTest(db, t)) });
  }
  return out;
}

// Snimak stanja baze (posle osnove i migracija), da se mutacije ne plaćaju po 6+ sekundi pokretanja.
export async function snapshot(db) {
  return db.dumpDataDir('none');
}
