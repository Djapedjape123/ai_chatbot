// Mutacije povezivanja Faze 3, korak 3.5 (rute /api/ingest i /api/attachments/docx, chat stranica, worker). Dva sloja:
//  - "static": hvata ih `npm test` (lib/file-guards.test.ts), brzo;
//  - "probe": hvata ih samo proba na pravom `next start` (build + tools/verify/probe-file-security.mjs), ~70 s po mutaciji.
// Pokretanje iz korena repozitorijuma: node tools/verify/mutations-app-3-5.mjs [static|probe]
// Na kraju pravi čist build i ponovo pušta probu, da .next ne ostane od mutirane verzije.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations, runUnitTests } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (...parts) => path.join(root, ...parts);
const ingest = f('app', 'api', 'ingest', 'route.ts');
const attachment = f('app', 'api', 'attachments', 'docx', 'route.ts');
const chatPage = f('app', 'chat', 'page.tsx');
const fileRead = f('lib', 'file-read.ts');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildEnv = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-key' };

function build() {
  return spawnSync(npm, ['run', 'build'], { cwd: root, env: buildEnv, encoding: 'utf8', shell: true });
}
function probe() {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'tools/verify/probe-file-security.mjs'],
    { cwd: root, encoding: 'utf8', timeout: 600_000 }
  );
  const fails = [...(r.stdout ?? '').matchAll(/^ {2}FAIL (.+)$/gm)].map((m) => m[1]);
  return { code: r.status, fails, summary: /(\d+ provera prošlo, \d+ palo)/.exec(r.stdout ?? '')?.[1] ?? 'bez rezimea' };
}

const mutations = [
  // ---- hvata ih statički test (lib/file-guards.test.ts)
  { layer: 'static', name: 'ingest: tip fajla po MIME tipu umesto po sadržaju', file: ingest, from: 'const kind = detectFileType(bytes);', to: "const kind = (file.type === 'application/pdf' ? 'pdf' : 'docx') as 'pdf' | 'docx';" },
  { layer: 'static', name: 'prilog: nema IP burst zaštite', file: attachment, from: 'const burstBlock = await enforceIpBurst(ip);', to: 'const burstBlock = null as Response | null;' },
  { layer: 'static', name: 'ingest: audit dobija naziv fajla', file: ingest, from: 'size_bytes: file.size },\n        });\n      } else {', to: 'size_bytes: file.size, name: file.name },\n        });\n      } else {' },
  { layer: 'static', name: 'ingest: document_uploaded bez vrste fajla', file: ingest, from: '          file_kind: kind,\n          size_bytes: file.size,', to: '          size_bytes: file.size,' },
  { layer: 'static', name: 'chat stranica ponovo parsira Word u pregledaču', file: chatPage, from: "import { MAX_FILE_SIZE } from '@/lib/ingest';", to: "import { MAX_FILE_SIZE } from '@/lib/ingest';\nimport * as mammoth from 'mammoth';" },
  { layer: 'static', name: 'worker se pokreće sa promenljivom umesto doslovnog izraza', file: fileRead, from: "new Worker(new URL('./file-worker.ts', import.meta.url), {", to: "new Worker(String('./file-worker.ts'), {" },
  { layer: 'static', name: 'prilog: rezerviše limit u ledger-u', file: attachment, from: "import { logAudit } from '@/lib/audit';", to: "import { logAudit } from '@/lib/audit';\nimport { reserveUsage } from '@/lib/usage';\nvoid reserveUsage;" },
  { layer: 'static', name: 'prilog: prihvata i PDF u proveri koja ide pre čitanja (guard uklonjen iz teksta)', file: attachment, from: "if (kind === 'pdf' || kind === 'unknown') return reject({ ok: false, reason: 'unsupported_type' });", to: "if (kind === 'unknown') return reject({ ok: false, reason: 'unsupported_type' });" },

  // ---- hvata ih samo proba na pravom serveru
  // Rani return-ovi se ne mogu ukloniti (TypeScript ne bi pustio 'unknown' do readFileInWorker, pa build pada), zato se
  // menja razlog koji vraćaju
  { layer: 'probe', name: 'ingest: nepoznat tip se prijavljuje kao oštećen Word', file: ingest, from: "if (kind === 'unknown') return reject({ ok: false, reason: 'unsupported_type' });", to: "if (kind === 'unknown') return reject({ ok: false, reason: 'unreadable_docx', finding: 'x' });" },
  { layer: 'probe', name: 'ingest: stari .doc i šifrovan Word se prijavljuju kao nepodržan tip', file: ingest, from: "return reject({ ok: false, reason: kind });", to: "return reject({ ok: false, reason: 'unsupported_type' });" },
  { layer: 'probe', name: 'ingest: Word se čita kao PDF', file: ingest, from: 'const read = await readFileInWorker({ kind, bytes });', to: "const read = await readFileInWorker({ kind: 'pdf', bytes });" },
  { layer: 'probe', name: 'ingest: odbijanje bez vrste fajla u auditu', file: ingest, from: 'if (!read.ok) return reject(read, kind);', to: 'if (!read.ok) return reject(read);' },
  { layer: 'probe', name: 'ingest: odbijanje se ne upisuje u audit', file: ingest, from: 'if (d.audit) {', to: 'if (false as boolean) {' },
  { layer: 'probe', name: 'ingest: poruka za prazan Word je poruka za PDF', file: ingest, from: "kind === 'pdf' ? 'PDF ne sadrži tekst ili je skenirana slika (potreban je OCR).' : 'Word dokument ne sadrži tekst.',", to: "'PDF ne sadrži tekst ili je skenirana slika (potreban je OCR).'," },
  { layer: 'probe', name: 'ingest: prazan tekst prolazi dalje', file: ingest, from: 'if (rawText.trim().length === 0) {', to: 'if (false as boolean) {' },
  { layer: 'probe', name: 'prilog: PDF se prihvata kao prilog', file: attachment, from: "if (kind === 'pdf' || kind === 'unknown') return reject({ ok: false, reason: 'unsupported_type' });", to: "if (kind === 'unknown') return reject({ ok: false, reason: 'unsupported_type' });" },
  { layer: 'probe', name: 'prilog: poruka za nepodržan tip je ona za bazu znanja', file: attachment, from: "describeRejection(rejection, 'attachment')", to: 'describeRejection(rejection)' },
  { layer: 'probe', name: 'prilog: audit bez oznake konteksta', file: attachment, from: "metadata: { ...d.audit, context: 'attachment', ", to: 'metadata: { ...d.audit, ' },
  { layer: 'probe', name: 'prilog: vraća skraćen tekst', file: attachment, from: 'return NextResponse.json({ text: read.text });', to: 'return NextResponse.json({ text: read.text.slice(0, 10) });' },
  { layer: 'probe', name: 'prilog: prazan tekst prolazi', file: attachment, from: 'if (read.text.trim().length === 0) {', to: 'if (false as boolean) {' },
  { layer: 'probe', name: 'prilog: stari .doc i šifrovan Word se ne odbijaju pre čitanja', file: attachment, from: "if (kind === 'legacy_doc' || kind === 'encrypted_office') return reject({ ok: false, reason: kind });", to: '' },
  { layer: 'probe', name: 'prilog: odbijanje bez vrste fajla u auditu', file: attachment, from: "if (!read.ok) return reject(read, 'docx');", to: 'if (!read.ok) return reject(read);' },
  { layer: 'probe', name: 'prilog: blokiran nalog dobija tekst', file: attachment, from: 'if (!user) return errorResponse!;', to: "if (!user) return NextResponse.json({ text: 'x' });" },
];

const only = process.argv[2]; // "static" ili "probe"
const nameFilter = process.argv[3]; // opciono: samo mutacije čije ime sadrži taj tekst
const selected = (only ? mutations.filter((m) => m.layer === only) : mutations).filter((m) => !nameFilter || m.name.includes(nameFilter));

const { results, intact } = await runMutations(
  selected,
  (m) => {
    if (m.layer === 'static') return runUnitTests(root);
    const b = build();
    if (b.status !== 0) return { invalid: true, failed: false, detail: `build pada: ${(b.stdout + b.stderr).split('\n').find((l) => /error|Error|Type/.test(l))?.slice(0, 120)}` };
    const p = probe();
    return { failed: p.code !== 0, detail: `${p.summary}; pale: ${p.fails.slice(0, 2).join(' | ').slice(0, 130)}` };
  },
  { label: 'Mutacije povezivanja (3.5)' }
);

if (!only || only === 'probe') {
  console.log('\nČist build i kontrolna proba posle vraćanja fajlova...');
  const b = build();
  const p = b.status === 0 ? probe() : { code: 1, summary: 'build pada' };
  console.log(`kontrola: build ${b.status === 0 ? 'prolazi' : 'PADA'}, proba: ${p.summary}`);
  if (b.status !== 0 || p.code !== 0) process.exit(1);
}
process.exit(intact && results.every((r) => r.status === 'UHVAĆENA') ? 0 : 1);
