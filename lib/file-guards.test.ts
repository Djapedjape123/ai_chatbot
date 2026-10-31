import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Statička provera pravila Faze 3 (bezbednost fajlova), plan docs/file-security-plan.md. Ne zamenjuje probu na pravom
// serveru (tools/verify/probe-file-security.mjs), ali hvata ono što bi nova ruta ili izmena tiho zaboravila:
//  - fajl se čita SAMO preko worker-a sa proverama (nijedna ruta ne uvozi unpdf ni mammoth direktno);
//  - tip fajla određuje sadržaj, ne ime ni MIME tip;
//  - redosled u rutama: IP burst, prijava, čitanje; odbijanje fajla ne troši ledger;
//  - poziv worker-a ostaje doslovan izraz (Turbopack inače povlači ceo projekat i build pada).

const root = path.resolve(import.meta.dirname, '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const rel = (file: string) => path.relative(root, file).replaceAll('\\', '/');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

const ingest = read('app', 'api', 'ingest', 'route.ts');
const attachment = read('app', 'api', 'attachments', 'docx', 'route.ts');

// Argumenti svakog poziva funkcije, do uparene zatvorene zagrade
function callsOf(source: string, call: string): string[] {
  const found: string[] = [];
  let from = source.indexOf(call);
  while (from !== -1) {
    let depth = 1;
    let i = from + call.length;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    found.push(source.slice(from + call.length, i - 1));
    from = source.indexOf(call, i);
  }
  return found;
}

// Mesto prvog poziva (ne uvoza): imena u import redovima se ne računaju
const callAt = (source: string, call: string) => source.indexOf(call);

test('rute za fajlove postoje i čitaju fajl preko worker-a (provera nije prazna)', () => {
  assert.ok(callAt(ingest, 'readFileInWorker(') > 0);
  assert.ok(callAt(attachment, 'readFileInWorker(') > 0);
});

test('app/ ne uvozi unpdf ni mammoth: parsiranje ide samo kroz lib/file-read.ts (worker, provere, ograničenje vremena)', () => {
  const offenders = walk(path.join(root, 'app'))
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => /from\s+['"](unpdf|mammoth)['"]|require\(['"](unpdf|mammoth)['"]\)|import\(['"](unpdf|mammoth)['"]\)/.test(fs.readFileSync(f, 'utf8')))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test('rute određuju tip po sadržaju (detectFileType), a ne po MIME tipu ni ekstenziji', () => {
  for (const [name, source] of [['ingest', ingest], ['attachments/docx', attachment]] as const) {
    assert.ok(callAt(source, 'detectFileType(') > 0, `${name}: nema detectFileType`);
    assert.ok(!/file\.type\b/.test(source), `${name}: gleda MIME tip`);
    assert.ok(!/\.endsWith\(\s*['"]\.(pdf|docx)['"]/i.test(source), `${name}: gleda ekstenziju`);
  }
});

test('redosled u rutama: IP burst, pa prijava, pa čitanje fajla', () => {
  for (const [name, source] of [['ingest', ingest], ['attachments/docx', attachment]] as const) {
    const burst = callAt(source, 'enforceIpBurst(');
    const auth = callAt(source, 'requireUser(');
    const readAt = callAt(source, 'readFileInWorker(');
    assert.ok(burst > 0 && auth > burst && readAt > auth, `${name}: ${burst} < ${auth} < ${readAt}`);
  }
});

test('/api/ingest: fajl se čita i proverava PRE rezervacije u ledger-u (odbijen fajl ne troši limit)', () => {
  const readAt = callAt(ingest, 'readFileInWorker(');
  const reserve = callAt(ingest, 'reserveUsage(');
  assert.ok(readAt > 0 && reserve > readAt, `${readAt} < ${reserve}`);
  assert.ok(callAt(ingest, 'detectFileType(') < readAt);
});

test('/api/attachments/docx: ništa se ne čuva i ne troši: bez rezervacije, bez Voyage-a, bez upisa osim audita', () => {
  assert.ok(!attachment.includes('reserveUsage'));
  assert.ok(!attachment.includes('voyage'));
  assert.ok(!/supabaseAdmin/.test(attachment), 'ruta ne dira bazu direktno (audit ide kroz lib/audit)');
  assert.ok(!/\.from\(/.test(attachment));
});

test('/api/attachments/docx prima samo Word: PDF i nepoznato se odbijaju pre čitanja', () => {
  const guard = attachment.indexOf("kind === 'pdf' || kind === 'unknown'");
  const readAt = callAt(attachment, 'readFileInWorker(');
  assert.ok(guard > 0 && guard < readAt);
  assert.ok(/readFileInWorker\(\{\s*kind:\s*'docx'/.test(attachment));
});

test('odbijanje fajla ide u audit kao document_upload_blocked, a poruka iz describeRejection (jedan izvor)', () => {
  for (const [name, source] of [['ingest', ingest], ['attachments/docx', attachment]] as const) {
    assert.ok(source.includes("'document_upload_blocked'"), name);
    assert.ok(source.includes('describeRejection('), name);
  }
  assert.ok(attachment.includes("context: 'attachment'"));
});

test('audit nikad ne dobija naziv fajla: metadata ne čita file.name', () => {
  for (const [name, source] of [['ingest', ingest], ['attachments/docx', attachment]] as const) {
    const auditCalls = callsOf(source, 'logAudit(');
    assert.ok(auditCalls.length > 0, `${name}: nema logAudit poziva`);
    for (const call of auditCalls) assert.ok(!/file\.name|title/.test(call), `${name}: ${call.slice(0, 120)}`);
  }
});

test('/api/ingest: upisan dokument nosi vrstu fajla (probi nije dostupno: uspeh zavisi od Voyage-a)', () => {
  const uploaded = callsOf(ingest, 'logAudit(').find((c) => c.includes("'document_uploaded'"));
  assert.ok(uploaded, 'nema audita document_uploaded');
  assert.ok(/file_kind:\s*kind/.test(uploaded), uploaded.slice(0, 200));
});

test('lib/file-read.ts: worker se pokreće doslovnim izrazom new Worker(new URL(..., import.meta.url))', () => {
  const source = read('lib', 'file-read.ts');
  assert.ok(/new Worker\(\s*new URL\('\.\/file-worker\.ts',\s*import\.meta\.url\)/.test(source));
});

test('chat stranica ne parsira Word u pregledaču: šalje fajl ruti priloga', () => {
  const page = read('app', 'chat', 'page.tsx');
  assert.ok(!/mammoth/.test(page));
  assert.ok(page.includes('/api/attachments/docx'));
});

test('komponenta za dokumente prima PDF i Word', () => {
  const uploader = read('app', 'components', 'PdfUploader.tsx');
  assert.ok(uploader.includes('.docx'));
  assert.ok(uploader.includes('.pdf'));
});
