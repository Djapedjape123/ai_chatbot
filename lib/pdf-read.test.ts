import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PDF_MAX_OBJECT_STREAM_BYTES, PDF_MAX_PAGES } from './pdf-inspect.ts';
import { readPdf } from './pdf-read.ts';
import { SAMPLE_TEXT, basePdf, basePdfObjects, buildPdf, type PdfObject } from './test-support/pdf-builder.ts';

const JS = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';

test('readPdf: granica je 300 strana', () => {
  assert.equal(PDF_MAX_PAGES, 300);
});

test('readPdf: običan PDF se čita, tekst i broj strana su tačni', async () => {
  const r = await readPdf(basePdf());
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.text.includes(SAMPLE_TEXT));
  assert.ok(r.ok && r.pages === 1);
});

test('readPdf: PDF sa kompresovanim tokom objekata, smećem ispred zaglavlja i samo vlasničkom lozinkom se čita', async () => {
  for (const options of [{ compress: [1, 2, 10, 5] }, { prefix: 'smece smece\n' }, { encrypt: { userPassword: '' } }]) {
    const r = await readPdf(basePdf(options));
    assert.ok(r.ok && r.text.includes(SAMPLE_TEXT), JSON.stringify(options));
  }
});

test('readPdf: PDF sa lozinkom za otvaranje je encrypted_pdf', async () => {
  const r = await readPdf(basePdf({ encrypt: { userPassword: 'tajna' } }));
  assert.deepEqual(r, { ok: false, reason: 'encrypted_pdf' });
});

test('readPdf: ne oduzima pozivaocu bajtove (pdf.js inače prazni prosleđeni bafer)', async () => {
  const bytes = basePdf();
  const before = bytes.length;
  await readPdf(bytes);
  assert.equal(bytes.length, before);
  assert.ok((await readPdf(bytes)).ok, 'drugo čitanje istih bajtova mora da uspe');
});

test('readPdf: tačno 300 strana prolazi, 301 se odbija pre čitanja teksta', async () => {
  assert.ok((await readPdf(basePdf({ pages: PDF_MAX_PAGES }))).ok);
  const r = await readPdf(basePdf({ pages: PDF_MAX_PAGES + 1 }));
  assert.deepEqual(r, { ok: false, reason: 'too_many_pages', pages: PDF_MAX_PAGES + 1 });
});

test('readPdf: oštećeni i lažni PDF-ovi su unreadable_pdf', async () => {
  const text = (s: string) => new TextEncoder().encode(s);
  assert.deepEqual(await readPdf(text('%PDF-1.7\nOvo je samo tekst, nije PDF.')), { ok: false, reason: 'unreadable_pdf' });
  assert.deepEqual(await readPdf(basePdf().slice(0, 120)), { ok: false, reason: 'unreadable_pdf' });
  assert.deepEqual(await readPdf(new Uint8Array(0)), { ok: false, reason: 'unreadable_pdf' });
});

test('readPdf: PDF bez teksta (skeniran) se čita, tekst je prazan (ruta ga odbija kao no_text)', async () => {
  const r = await readPdf(basePdf({ text: '' }));
  assert.ok(r.ok && r.text.trim() === '');
});

test('readPdf: JavaScript, Launch i prilozi se odbijaju kao active_content sa vrstom nalaza', async () => {
  const withLink = (action: string) =>
    buildPdf([...basePdfObjects({ pageExtra: '/Annots [20 0 R]' }), { num: 20, body: `<< /Type /Annot /Subtype /Link /Rect [0 0 50 50] /A ${action} >>` }]);
  assert.deepEqual(await readPdf(basePdf({ catalogExtra: `/OpenAction ${JS}` })), { ok: false, reason: 'active_content', finding: 'pdf_javascript' });
  assert.deepEqual(await readPdf(withLink(JS)), { ok: false, reason: 'active_content', finding: 'pdf_javascript' });
  assert.deepEqual(await readPdf(withLink('<< /S /Launch /F (cmd.exe) >>')), { ok: false, reason: 'active_content', finding: 'pdf_launch' });
});

test('readPdf: JavaScript sakriven u šifrovanom kompresovanom toku vidi sloj (b), preko pdf.js-a', async () => {
  const bytes = buildPdf([...basePdfObjects({ catalogExtra: '/OpenAction 20 0 R' }), { num: 20, body: JS }], {
    compress: [1, 20],
    encrypt: { userPassword: '' },
  });
  assert.equal(Buffer.from(bytes).includes('JavaScript'), false, 'uzorak ne sme da otkriva reč u sirovim bajtovima');
  assert.deepEqual(await readPdf(bytes), { ok: false, reason: 'active_content', finding: 'pdf_javascript' });
});

test('readPdf: ZNANA PRAZNINA (dokumentovana u lib/pdf-inspect.ts): akcija linka u šifrovanom ObjStm-u se ne vidi', async () => {
  const bytes = buildPdf(
    [...basePdfObjects({ pageExtra: '/Annots [20 0 R]' }), { num: 20, body: `<< /Type /Annot /Subtype /Link /Rect [0 0 50 50] /A ${JS} >>` }],
    { compress: [1, 2, 10, 20, 5], encrypt: { userPassword: '' } }
  );
  const r = await readPdf(bytes);
  assert.equal(r.ok, true, 'ako ovaj test padne, praznina je zatvorena: promeniti test i napomenu u lib/pdf-inspect.ts');
});

test('readPdf: bomba u toku objekata je archive_bomb', async () => {
  const bomb: PdfObject = {
    num: 30,
    body: '<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode >>',
    stream: deflateSync(new Uint8Array(PDF_MAX_OBJECT_STREAM_BYTES + 1024)),
  };
  const r = await readPdf(buildPdf([...basePdfObjects(), bomb]));
  assert.deepEqual(r, { ok: false, reason: 'archive_bomb', finding: 'pdf_object_stream_too_large' });
});

test('readPdf: PDF kome strana ne može da se pročita (otvara se, ali puca pri čitanju) je unreadable_pdf', async () => {
  const objects = basePdfObjects().filter((o) => o.num !== 10 && o.num !== 11);
  assert.deepEqual(await readPdf(buildPdf(objects)), { ok: false, reason: 'unreadable_pdf' });
});
