import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Statička provera pravila Faze 3.5 (slike sa telefona), plan docs/camera-images-plan.md. Ne zamenjuje probu na
// pravom serveru, ali hvata ono što bi izmena tiho zaboravila:
//  - slika se proverava po sadržaju (inspectImages) PRE rezervacije, pa odbijena slika ne troši limit;
//  - redosled: IP burst, prijava, čitanje tela;
//  - slika se ne čuva nigde (nema Storage-a, nema upisa slike u tabele) i ne ide u log;
//  - prepis se uvek zatvara kao release (dokument se broji tek pri indeksiranju);
//  - audit nikad ne dobija naziv fajla ni sadržaj.

const root = path.resolve(import.meta.dirname, '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const chat = read('app', 'api', 'chat', 'route.ts');
const transcribe = read('app', 'api', 'ingest', 'transcribe', 'route.ts');
const textRoute = read('app', 'api', 'ingest', 'text', 'route.ts');

const at = (source: string, call: string) => source.indexOf(call);

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

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

test('redosled u rutama sa slikama: IP burst, pa prijava, pa čitanje tela', () => {
  for (const [name, source, body] of [
    ['chat', chat, 'req.formData('],
    ['transcribe', transcribe, 'req.formData('],
    ['text', textRoute, 'req.json('],
  ] as const) {
    const burst = at(source, 'enforceIpBurst(');
    const auth = at(source, 'requireUser(');
    const read = at(source, body);
    assert.ok(burst > 0 && burst < auth && auth < read, `${name}: ${burst} < ${auth} < ${read}`);
  }
});

test('/api/chat: slike se proveravaju po sadržaju PRE rezervacije i pre upisa poruke', () => {
  const inspect = at(chat, 'inspectImages(');
  assert.ok(inspect > 0);
  assert.ok(inspect < at(chat, 'reserveUsage('));
  assert.ok(inspect < at(chat, ".from('messages')\n      .insert"));
  // Claude dobija proverene (očišćene) slike, ne sirove fajlove
  assert.ok(/buildImageUserContent\(images,/.test(chat));
  assert.ok(/images = checked\.images/.test(chat));
});

test('/api/chat: u istoriju ide oznaka, ne slika; procena tokena uključuje slike', () => {
  const insert = callsOf(chat, '.insert(').find((c) => c.includes("role: 'user'"));
  assert.ok(insert, 'nema upisa korisnikove poruke');
  assert.ok(insert.includes('imageMessageContent('), insert);
  assert.ok(!/base64|bytes/.test(insert), insert);
  assert.ok(chat.replace(/\s+/g, ' ').includes('estimateChatTokens(trimmedQuery, formattedHistory.map((h) => h.content)) + imageTokens'));
});

test('/api/ingest/transcribe: slika pre rezervacije, uvek release, bez settle i bez upisa u bazu', () => {
  const inspect = at(transcribe, 'inspectImages(');
  const reserve = at(transcribe, 'reserveUsage(');
  assert.ok(inspect > 0 && reserve > inspect);
  assert.ok(/reserveUsage\(actor, 'ingest'/.test(transcribe));
  assert.ok(!transcribe.includes('settleUsage'), 'prepis ne sme da broji dokument');
  const fin = transcribe.slice(transcribe.lastIndexOf('finally {'));
  assert.ok(/releaseUsage\(/.test(fin), 'release mora biti u finally');
  assert.ok(!/supabaseAdmin|\.from\(/.test(transcribe), 'ruta ne dira bazu direktno');
});

test('/api/ingest/text: naziv se čisti, dokument ide kroz zajednički pipeline kao slika sa brojem strana', () => {
  const call = callsOf(textRoute, 'indexDocumentText(')[0] ?? '';
  assert.ok(/fileKind:\s*'image'/.test(call), call);
  assert.ok(/pages/.test(call), call);
  assert.ok(at(textRoute, 'sanitizeTitle(') > 0 && at(textRoute, 'sanitizeTitle(') < at(textRoute, 'indexDocumentText('));
  assert.ok(!textRoute.includes('reserveUsage('), 'rezervacija samo kroz indexDocumentText');
});

test('odbijena slika ide u audit sa kontekstom i vrstom, bez naziva fajla, poruka iz describeRejection', () => {
  for (const [name, source, context] of [
    ['chat', chat, 'chat_image'],
    ['transcribe', transcribe, 'transcribe'],
  ] as const) {
    assert.ok(source.includes("describeRejection(checked.rejection, 'image')"), name);
    const blocked = callsOf(source, 'logAudit(').find((c) => c.includes("'document_upload_blocked'"));
    assert.ok(blocked, name);
    assert.ok(blocked.includes(`context: '${context}'`), `${name}: ${blocked}`);
    assert.ok(blocked.includes("file_kind: 'image'"), name);
    assert.ok(!/\.name\b|title|\bbytes\b|base64/.test(blocked), `${name}: ${blocked}`);
  }
});

test('slika se ne čuva nigde: nema Supabase Storage-a i nijedan log ne ispisuje sliku', () => {
  const sources = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))]
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts') && !f.includes(`${path.sep}test-support${path.sep}`));
  for (const f of sources) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/\.storage\b/.test(s), `${path.relative(root, f)} koristi Storage`);
  }
  for (const [name, source] of [['chat', chat], ['transcribe', transcribe]] as const) {
    for (const call of callsOf(source, 'console.error(')) {
      assert.ok(!/images|image\b|bytes|base64|page\b/.test(call), `${name}: ${call}`);
    }
  }
});
