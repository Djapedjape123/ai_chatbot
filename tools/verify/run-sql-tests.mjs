// Primenjuje osnovu (stanje pre Faze 1) i sve migracije iz supabase/migrations redom na lokalnoj bazi (PGlite),
// pa pokreće SQL testove iz supabase/tests. Jedna linija po testu (ok / FAIL), kod izlaza 1 ako bilo koji padne.
//
//   node tools/verify/run-sql-tests.mjs                      # sve migracije, svi testovi
//   node tools/verify/run-sql-tests.mjs --upto=20261029100000 # samo migracije do ove (uključivo), npr. stanje PRE 2.5.11
//   node tools/verify/run-sql-tests.mjs --tests=phase1,phase2 # samo testovi čije ime sadrži jedan od ovih delova
import { applyBaseline, applyMigrations, createDb, runAllTests } from './lib/pglite-db.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const upto = arg('upto');
const names = arg('tests')?.split(',');

const t0 = Date.now();
const db = await createDb();
await applyBaseline(db);
const applied = await applyMigrations(db, { upto });
console.log(`migracije primenjene (${applied.length}): ${applied.map((n) => n.slice(0, 14)).join(', ')}`);

const results = await runAllTests(db, { names });
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.message}`);
}
if (results.length === 0) {
  console.log('FAIL nijedan test nije pokrenut');
  failed++;
}
console.log(`${results.length - failed}/${results.length} testova prošlo za ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await db.close();
process.exit(failed ? 1 : 0);
