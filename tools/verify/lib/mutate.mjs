// Namerne greške (mutacije): kvari kopiju jednog izraza u izvornom fajlu, pokreće proveru i očekuje da PADNE.
// Mutacija koja preživi znači da neki test ne čuva to ponašanje (ili je mutacija ekvivalentna: tada se to piše u izveštaj).
//
// Bezbednost: svaki fajl koji se menja prethodno se kopira u memoriju i vraća u `finally`, a dodatno pri izlazu procesa
// (Ctrl+C, izuzetak). Pre i posle serije proverava se da je sadržaj fajlova identičan originalu.

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const originals = new Map(); // fajl -> sadržaj pre prve mutacije

function restoreAll() {
  for (const [file, content] of originals) fs.writeFileSync(file, content);
}
process.on('exit', restoreAll);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

const hash = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);

/**
 * mutations: [{ name, file, from, to, equivalent? }]  (from mora da se pojavi tačno jednom)
 * run: () => { failed: boolean, detail?: string }  (true = provera je PALA, mutacija je uhvaćena)
 */
export async function runMutations(mutations, run, { label = 'mutacije' } = {}) {
  const results = [];
  for (const m of mutations) {
    if (!originals.has(m.file)) originals.set(m.file, fs.readFileSync(m.file, 'utf8'));
  }
  const before = new Map([...originals].map(([f, c]) => [f, hash(c)]));

  for (const m of mutations) {
    const source = originals.get(m.file);
    const occurrences = source.split(m.from).length - 1;
    if (occurrences !== 1) {
      results.push({ ...m, status: 'NEPRIMENJENA', detail: `izraz se pojavljuje ${occurrences} puta` });
      console.log(`  ?? ${m.name}: NEPRIMENJENA (${occurrences} pojavljivanja)`);
      continue;
    }
    fs.writeFileSync(m.file, source.replace(m.from, () => m.to));
    try {
      const outcome = await run(m);
      // invalid: mutacija ne daje program koji može da se proveri (npr. build pada), pa se NE računa kao uhvaćena
      const status = outcome.invalid ? 'NEPRIMENJENA' : outcome.failed ? 'UHVAĆENA' : 'PREŽIVELA';
      results.push({ ...m, status, detail: outcome.detail });
      console.log(`  ${outcome.invalid ? '??  ' : outcome.failed ? 'ok  ' : '!!  '} ${m.name}: ${status}${outcome.detail ? ` (${outcome.detail})` : ''}`);
    } finally {
      fs.writeFileSync(m.file, source);
    }
  }

  restoreAll();
  const intact = [...originals].every(([f, c]) => hash(fs.readFileSync(f, 'utf8')) === before.get(f) && fs.readFileSync(f, 'utf8') === c);
  const caught = results.filter((r) => r.status === 'UHVAĆENA').length;
  const survived = results.filter((r) => r.status === 'PREŽIVELA');
  const unapplied = results.filter((r) => r.status === 'NEPRIMENJENA');
  console.log(`\n${label}: ${results.length} mutacija, ${caught} uhvaćeno, ${survived.length} preživelo, ${unapplied.length} neprimenjeno; fajlovi vraćeni: ${intact ? 'da' : 'NE!'}`);
  for (const s of survived) console.log(`  preživela: ${s.name}${s.equivalent ? ` (označena kao ekvivalentna: ${s.equivalent})` : ''}`);
  return { results, intact };
}

// Pokreće `npm test` (node:test) i vraća da li je pao
export function runUnitTests(cwd) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--test', 'lib/**/*.test.ts'], {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  const failedNames = [...(r.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  return { failed: r.status !== 0, detail: failedNames.slice(0, 2).join(' | ').slice(0, 110) };
}
