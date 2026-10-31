// Proba Faze 3 (bezbednost fajlova): POST /api/ingest i POST /api/attachments/docx na pravom `next start`
// (sa pravim worker nitima) i lažnim Supabase-om.
//
// Šta dokazuje: da svaki loš fajl dobija tačan kod i poruku, da audit dobija razlog bez naziva fajla i sadržaja, da
// odbijanje ne dira ledger ni tabelu documents, da ispravan fajl STIŽE do rezervacije (reserve_usage), a Word prilog
// vraća tekst bez ikakvog upisa. Šta ne dokazuje: uspešan upis dokumenta (Voyage je spoljni servis), Vercel.
//
// Pokretanje iz korena repozitorijuma (.ts uzorci traže zastavicu; build sa lažnom adresom, vidi README.md):
//   node --experimental-strip-types --disable-warning=ExperimentalWarning tools/verify/probe-file-security.mjs

import { deflateSync } from 'node:zlib';
import { createFakeSupabase } from './lib/fake-supabase.mjs';
import { get, sessionCookie, startApp, textOf } from './lib/app.mjs';
import { basePdf, basePdfObjects, buildPdf } from '../../lib/test-support/pdf-builder.ts';
import { OLE_SIGNATURE, buildDocx, joinBytes, utf16le } from '../../lib/test-support/zip-builder.ts';

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `\n         ${String(detail).slice(0, 700).replace(/\n/g, '\n         ')}` : ''}`);
  }
}
const section = (title) => console.log(`\n${title}`);
// Lažni server čuva mikrosekunde kao BigInt: za ispis se pretvaraju u tekst
const j = (value) => JSON.stringify(value, (_key, x) => (typeof x === 'bigint' ? x.toString() : x));

const fake = createFakeSupabase();
const L = { id: '22222222-2222-4222-8222-222222222222', email: 'ana@kancelarija.rs', role: 'lawyer', full_name: 'Ana Anić' };
const B = { id: '44444444-4444-4444-8444-444444444444', email: 'blokiran@kancelarija.rs', role: 'lawyer', disabled_at: '2026-10-29T09:00:00+00:00' };
const cookies = { lawyer: sessionCookie(L), blocked: sessionCookie(B) };

// Ime fajla koje se NIKAD ne sme pojaviti u audit logu
const SECRET_NAME = 'tajni-ugovor-Petrovic-2026';

const text = (s) => new TextEncoder().encode(s);
const JS = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';
const MB = 1024 * 1024;

const samples = {
  textAsPdf: { bytes: text('Ovo je običan tekst, a ne PDF.'), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
  legacyDoc: { bytes: joinBytes(OLE_SIGNATURE, new Uint8Array(600)), name: `${SECRET_NAME}.doc`, type: 'application/msword' },
  encryptedOffice: {
    bytes: joinBytes(OLE_SIGNATURE, new Uint8Array(700), utf16le('EncryptionInfo'), new Uint8Array(30), utf16le('EncryptedPackage')),
    name: `${SECRET_NAME}.docx`,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  encryptedPdf: { bytes: basePdf({ encrypt: { userPassword: 'tajna' } }), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
  jsPdf: { bytes: buildPdf(basePdfObjects({ catalogExtra: `/OpenAction ${JS}` })), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
  macroDocx: { bytes: buildDocx([{ name: 'word/vbaProject.bin', data: 'MZ' }]), name: `${SECRET_NAME}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  bombDocx: { bytes: buildDocx([{ name: 'word/media/bomb.txt', data: new Uint8Array(60 * MB) }]), name: `${SECRET_NAME}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  manyPages: { bytes: basePdf({ pages: 301 }), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
  emptyPdf: { bytes: basePdf({ text: '' }), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
  emptyDocx: {
    bytes: buildDocx([{ name: 'word/document.xml', data: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>' }]),
    name: `${SECRET_NAME}.docx`,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  brokenPdf: { bytes: text('%PDF-1.7\nOvo samo liči na PDF, a nije.'), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
  goodPdf: { bytes: basePdf(), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
  goodDocx: { bytes: buildDocx(), name: `${SECRET_NAME}.docx`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  zeroDeflate: { bytes: deflateSync(new Uint8Array(10)), name: `${SECRET_NAME}.pdf`, type: 'application/pdf' },
};

async function upload(app, route, sample, { cookie, field = 'file', extra = {} } = {}) {
  const form = new FormData();
  if (sample) form.append(field, new Blob([sample.bytes], { type: sample.type }), sample.name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const res = await fetch(`${app.base}${route}`, { method: 'POST', redirect: 'manual', headers: cookie ? { cookie } : {}, body: form });
  const raw = await res.text();
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // nije JSON
  }
  return { status: res.status, json, raw, location: res.headers.get('location') };
}

const isWrite = (r) => r.path.startsWith('/rest/') && r.method !== 'GET' && r.method !== 'HEAD';
const isReserve = (r) => r.path === '/rest/v1/rpc/reserve_usage';
const isDocumentsWrite = (r) => r.path === '/rest/v1/documents' && r.method !== 'GET' && r.method !== 'HEAD';

function seed() {
  fake.reset();
  for (const u of [L, B]) fake.addUser(u);
}

function newAudit(from) {
  return fake.state.auditRows.slice(from);
}

async function main() {
  await fake.start();
  const app = await startApp({ port: 3111 });

  try {
    // Odbijanje na /api/ingest: kod, poruka, audit, bez ledger-a i bez dokumenta
    const rejections = [
      { key: 'textAsPdf', code: 'unsupported_type', reason: 'unsupported_type', msg: /PDF i Word/, kind: undefined },
      { key: 'legacyDoc', code: 'legacy_doc', reason: 'legacy_doc', msg: /Sačuvaj/, kind: undefined },
      { key: 'encryptedOffice', code: 'encrypted_office', reason: 'encrypted_office', msg: /lozink/, kind: undefined },
      { key: 'encryptedPdf', code: 'encrypted_pdf', reason: 'encrypted_pdf', msg: /lozink/, kind: 'pdf' },
      { key: 'jsPdf', code: 'active_content', reason: 'active_content', finding: 'pdf_javascript', msg: /JavaScript/, kind: 'pdf' },
      { key: 'macroDocx', code: 'active_content', reason: 'active_content', finding: 'docx_macro', msg: /makro/, kind: 'docx' },
      { key: 'bombDocx', code: 'archive_bomb', reason: 'archive_bomb', finding: 'zip_uncompressed_size', msg: /složen|velik/, kind: 'docx' },
      { key: 'manyPages', code: 'too_many_pages', reason: 'too_many_pages', msg: /301/, kind: 'pdf', pages: 301 },
      { key: 'emptyPdf', code: 'no_text', reason: 'no_text', msg: /skenirana|OCR/, kind: 'pdf' },
      { key: 'emptyDocx', code: 'no_text', reason: 'no_text', msg: /Word dokument ne sadrži tekst/, kind: 'docx' },
      { key: 'brokenPdf', code: 'invalid_pdf', reason: 'unreadable_pdf', msg: /nije ispravan PDF/, kind: 'pdf' },
      { key: 'zeroDeflate', code: 'unsupported_type', reason: 'unsupported_type', msg: /nije podržan/, kind: undefined },
    ];

    section('/api/ingest: odbijanja');
    for (const r of rejections) {
      seed();
      const sample = samples[r.key];
      const mark = fake.mark();
      const before = fake.state.auditRows.length;
      const res = await upload(app, '/api/ingest', sample, { cookie: cookies.lawyer });
      const audit = newAudit(before);
      const row = audit.find((a) => a.action === 'document_upload_blocked');
      const calls = fake.calls(() => true, mark);
      check(`${r.key}: 400 ${r.code} sa porukom na srpskom`, res.status === 400 && res.json?.code === r.code && r.msg.test(res.json?.error ?? ''), j(res.json) + ' / status ' + res.status);
      check(`${r.key}: audit document_upload_blocked sa razlogom ${r.reason}`, row?.metadata?.reason === r.reason, j(audit));
      if (r.finding) check(`${r.key}: audit nosi vrstu nalaza ${r.finding}`, row?.metadata?.finding === r.finding, j(row?.metadata));
      if (r.pages) check(`${r.key}: audit nosi broj strana`, row?.metadata?.pages === r.pages, j(row?.metadata));
      check(`${r.key}: audit nosi vrstu fajla ${r.kind ?? '(nema)'} i veličinu`, row?.metadata?.file_kind === r.kind && row?.metadata?.size_bytes === sample.bytes.length, j(row?.metadata));
      check(`${r.key}: ni naziv fajla ni sadržaj nisu u audit logu`, !j(audit).includes(SECRET_NAME) && !j(audit).includes('Član 1'));
      check(`${r.key}: nema rezervacije u ledger-u i nema upisa dokumenta`, !calls.some(isReserve) && !calls.some(isDocumentsWrite), j(calls.map((c) => `${c.method} ${c.path}`)));
      check(`${r.key}: jedini upis u bazu je audit`, calls.filter(isWrite).every((c) => c.path === '/rest/v1/audit_log'), j(calls.filter(isWrite).map((c) => c.path)));
    }

    section('/api/ingest: ispravan fajl prolazi sve provere i stiže do rezervacije');
    for (const key of ['goodPdf', 'goodDocx']) {
      seed();
      const mark = fake.mark();
      const before = fake.state.auditRows.length;
      const res = await upload(app, '/api/ingest', samples[key], { cookie: cookies.lawyer });
      const calls = fake.calls(() => true, mark);
      check(`${key}: rezervacija je pozvana (provere su prošle)`, calls.some(isReserve), j(calls.map((c) => c.path)));
      check(`${key}: nije odbijen kao fajl (nema document_upload_blocked)`, !newAudit(before).some((a) => a.action === 'document_upload_blocked'), j(newAudit(before)));
      check(`${key}: lažna baza nema rezervaciju, pa ruta staje zatvoreno (nije 200), bez poziva Voyage-a`, res.status !== 200 && !res.json?.success, `${res.status} ${res.raw.slice(0, 200)}`);
    }

    section('/api/ingest: zahtevi bez fajla, prevelik fajl, bez prijave, blokiran nalog');
    {
      seed();
      let res = await upload(app, '/api/ingest', null, { cookie: cookies.lawyer });
      check('bez fajla: 400 invalid_request', res.status === 400 && res.json?.code === 'invalid_request' && /Niste poslali fajl/.test(res.json?.error ?? ''), res.raw);
      res = await upload(app, '/api/ingest', { bytes: new Uint8Array(4 * MB + 1), name: 'x.pdf', type: 'application/pdf' }, { cookie: cookies.lawyer });
      check('preko 4MB: 400 sa porukom o veličini', res.status === 400 && /4MB/.test(res.json?.error ?? ''), res.raw.slice(0, 200));
      const mark = fake.mark();
      res = await upload(app, '/api/ingest', samples.goodPdf, {});
      check('bez prijave: preusmerenje ili 401, fajl se ne čita', (res.status === 307 || res.status === 308 || res.status === 401) && fake.calls(isReserve, mark).length === 0, `${res.status} ${res.raw.slice(0, 120)}`);
      const m2 = fake.mark();
      res = await upload(app, '/api/ingest', samples.jsPdf, { cookie: cookies.blocked });
      check('blokiran nalog: 403 account_blocked, bez audita odbijanja', res.status === 403 && res.json?.code === 'account_blocked' && !fake.state.auditRows.some((a) => a.action === 'document_upload_blocked') && fake.calls(isReserve, m2).length === 0, `${res.status} ${res.raw.slice(0, 200)}`);
    }

    section('/api/attachments/docx: Word prilog uz pitanje');
    {
      seed();
      const mark = fake.mark();
      const before = fake.state.auditRows.length;
      let res = await upload(app, '/api/attachments/docx', samples.goodDocx, { cookie: cookies.lawyer });
      const calls = fake.calls(() => true, mark);
      check('ispravan .docx: 200 i tekst dokumenta', res.status === 200 && /Član 1\. Ugovorne strane/.test(res.json?.text ?? ''), `${res.status} ${res.raw.slice(0, 200)}`);
      check('ispravan .docx: nema upisa ni u jednu tabelu, nema rezervacije i nema audita', !calls.some(isWrite) && !calls.some(isReserve) && newAudit(before).length === 0, j(calls.map((c) => `${c.method} ${c.path}`)));

      const attachmentRejections = [
        { key: 'goodPdf', code: 'unsupported_type', reason: 'unsupported_type', msg: /može da bude samo Word/, kind: undefined },
        { key: 'textAsPdf', code: 'unsupported_type', reason: 'unsupported_type', msg: /može da bude samo Word/, kind: undefined },
        { key: 'legacyDoc', code: 'legacy_doc', reason: 'legacy_doc', msg: /Sačuvaj/, kind: undefined },
        { key: 'encryptedOffice', code: 'encrypted_office', reason: 'encrypted_office', msg: /lozink/, kind: undefined },
        { key: 'macroDocx', code: 'active_content', reason: 'active_content', finding: 'docx_macro', msg: /makro/, kind: 'docx' },
        { key: 'bombDocx', code: 'archive_bomb', reason: 'archive_bomb', finding: 'zip_uncompressed_size', msg: /složen|velik/, kind: 'docx' },
        { key: 'emptyDocx', code: 'no_text', reason: 'no_text', msg: /ne sadrži tekst/, kind: 'docx' },
      ];
      for (const r of attachmentRejections) {
        seed();
        const sample = samples[r.key];
        const m = fake.mark();
        const b = fake.state.auditRows.length;
        res = await upload(app, '/api/attachments/docx', sample, { cookie: cookies.lawyer });
        const audit = newAudit(b);
        const row = audit.find((a) => a.action === 'document_upload_blocked');
        const c = fake.calls(() => true, m);
        check(`prilog ${r.key}: 400 ${r.code}`, res.status === 400 && res.json?.code === r.code && r.msg.test(res.json?.error ?? ''), `${res.status} ${res.raw.slice(0, 200)}`);
        check(`prilog ${r.key}: audit sa razlogom ${r.reason}, kontekstom "attachment", bez naziva fajla`, row?.metadata?.reason === r.reason && row?.metadata?.context === 'attachment' && row?.metadata?.file_kind === r.kind && !j(audit).includes(SECRET_NAME), j(row?.metadata));
        if (r.finding) check(`prilog ${r.key}: nalaz ${r.finding}`, row?.metadata?.finding === r.finding, j(row?.metadata));
        check(`prilog ${r.key}: jedini upis je audit, bez rezervacije`, c.filter(isWrite).every((x) => x.path === '/rest/v1/audit_log') && !c.some(isReserve));
      }

      seed();
      res = await upload(app, '/api/attachments/docx', null, { cookie: cookies.lawyer });
      check('prilog bez fajla: 400 invalid_request', res.status === 400 && res.json?.code === 'invalid_request', res.raw);
      res = await upload(app, '/api/attachments/docx', { bytes: new Uint8Array(4 * MB + 1), name: 'x.docx', type: 'application/octet-stream' }, { cookie: cookies.lawyer });
      check('prilog preko 4MB: 400 sa porukom o veličini', res.status === 400 && /4MB/.test(res.json?.error ?? ''), res.raw.slice(0, 200));
      res = await upload(app, '/api/attachments/docx', samples.goodDocx, {});
      check('prilog bez prijave: preusmerenje ili 401', res.status === 307 || res.status === 308 || res.status === 401, `${res.status}`);
      res = await upload(app, '/api/attachments/docx', samples.goodDocx, { cookie: cookies.blocked });
      check('prilog, blokiran nalog: 403 account_blocked', res.status === 403 && res.json?.code === 'account_blocked', `${res.status} ${res.raw.slice(0, 160)}`);
      const getRes = await fetch(`${app.base}/api/attachments/docx`, { headers: { cookie: cookies.lawyer }, redirect: 'manual' });
      check('GET na ruti priloga nije dozvoljen (405)', getRes.status === 405, String(getRes.status));
    }

    section('/activity: advokat vidi razloge odbijanja na srpskom, bez internih oznaka');
    {
      seed();
      await upload(app, '/api/ingest', samples.jsPdf, { cookie: cookies.lawyer });
      await upload(app, '/api/attachments/docx', samples.macroDocx, { cookie: cookies.lawyer });
      await upload(app, '/api/ingest', samples.manyPages, { cookie: cookies.lawyer });
      const page = await get(app, '/activity', { cookie: cookies.lawyer });
      const t = textOf(page.body);
      check('stranica se otvara', page.status === 200, String(page.status));
      check('prikazuje "Blokirano otpremanje" i "Fajl sadrži aktivan sadržaj"', /Blokirano otpremanje/.test(t) && /Fajl sadrži aktivan sadržaj/.test(t), t.slice(0, 600));
      check('prikazuje vrstu nalaza na srpskom', /Vrsta nalaza: JavaScript u PDF-u/.test(t) && /Vrsta nalaza: makroi/.test(t), t.slice(0, 900));
      check('prikazuje vrstu fajla, broj strana i prilog uz pitanje', /Vrsta fajla: PDF/.test(t) && /Vrsta fajla: Word \(\.docx\)/.test(t) && /Broj strana: 301/.test(t) && /Prilog uz pitanje/.test(t), t.slice(0, 900));
      check('nigde nema internih oznaka', !/pdf_javascript|docx_macro|too_many_pages|active_content|zip_/.test(t), t.slice(0, 600));
      check('nema naziva fajla', !t.includes(SECRET_NAME));
    }
  } finally {
    await app.stop();
    await fake.stop();
  }

  console.log(`\n${passed} provera prošlo, ${failed} palo`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
