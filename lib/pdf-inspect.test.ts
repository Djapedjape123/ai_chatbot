import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { getDocumentProxy } from 'unpdf';
import { PDF_MAX_OBJECT_STREAM_BYTES, PDF_MAX_PAGES, inspectPdfDocument, scanPdfStructure } from './pdf-inspect.ts';
import { basePdf, basePdfObjects, buildPdf, type BuildPdfOptions, type PdfObject } from './test-support/pdf-builder.ts';

const JS = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';
const text = (s: string) => new TextEncoder().encode(s);

// Strana 1 (objekat 10) dobija anotaciju 20; objekat 20 je zadati rečnik
function withAnnotation(annotation: string, extra: PdfObject[] = [], options: BuildPdfOptions = {}) {
  return buildPdf(
    [...basePdfObjects({ pageExtra: '/Annots [20 0 R]' }), { num: 20, body: annotation }, ...extra],
    options
  );
}

const linkWith = (action: string, options: BuildPdfOptions = {}) =>
  withAnnotation(`<< /Type /Annot /Subtype /Link /Rect [0 0 50 50] /A ${action} >>`, [], options);

function withCatalog(extra: string, objects: PdfObject[] = [], options: BuildPdfOptions = {}) {
  return buildPdf([...basePdfObjects({ catalogExtra: extra }), ...objects], options);
}

const attachment: PdfObject[] = [
  { num: 21, body: '<< /Type /Filespec /F (a.txt) /EF << /F 22 0 R >> >>' },
  { num: 22, body: '<< /Type /EmbeddedFile >>', stream: 'tajni sadrzaj' },
];

function activeFinding(bytes: Uint8Array) {
  const r = scanPdfStructure(bytes);
  assert.equal(r.kind, 'active_content', `očekivan nalaz, a dobijeno ${JSON.stringify(r)}`);
  return (r as Extract<typeof r, { kind: 'active_content' }>).finding;
}

// --- Sloj (a): čitač strukture ---

test('scanPdfStructure: običan PDF i PDF sa običnim URI vezama su čisti (lažno pozitivni)', () => {
  assert.deepEqual(scanPdfStructure(basePdf()), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(basePdf({ catalogExtra: '/OpenAction [10 0 R /Fit]' })), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(linkWith('<< /S /URI /URI (https://example.com/zakon) >>')), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(linkWith('<< /S /GoTo /D [10 0 R /Fit] >>')), { kind: 'clean' });
});

test('scanPdfStructure: JavaScript u OpenAction, u stablu imena i u akciji linka', () => {
  assert.equal(activeFinding(withCatalog(`/OpenAction ${JS}`)), 'pdf_javascript');
  assert.equal(activeFinding(withCatalog('/Names 20 0 R', [{ num: 20, body: `<< /JavaScript << /Names [(a) ${JS}] >> >>` }])), 'pdf_javascript');
  assert.equal(activeFinding(linkWith(JS)), 'pdf_javascript');
});

test('scanPdfStructure: samo ključ /JS (bez /S /JavaScript) je takođe JavaScript', () => {
  assert.equal(activeFinding(linkWith('<< /JS (x) >>')), 'pdf_javascript');
});

test('scanPdfStructure: ime zapisano sa #xx se normalizuje (/J#61vaScript, /#4A#53)', () => {
  assert.equal(activeFinding(linkWith('<< /S /J#61vaScript /JS (x) >>')), 'pdf_javascript');
  assert.equal(activeFinding(linkWith('<< /#4A#53 (x) >>')), 'pdf_javascript');
  assert.equal(activeFinding(linkWith('<< /S /#4Aava#53cript >>')), 'pdf_javascript');
});

test('scanPdfStructure: imena bez razmaka uz delimitere (/S/JavaScript/JS(x)) se čitaju', () => {
  assert.equal(activeFinding(linkWith('<</S/JavaScript/JS(x)>>')), 'pdf_javascript');
});

test('scanPdfStructure: Launch, ugrađeni fajl, RichMedia, XFA, SubmitForm i ImportData', () => {
  assert.equal(activeFinding(linkWith('<< /S /Launch /F (cmd.exe) >>')), 'pdf_launch');
  assert.equal(activeFinding(withAnnotation('<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 5 5] /FS 21 0 R >>', attachment)), 'pdf_embedded_file');
  assert.equal(activeFinding(withCatalog('/Names 20 0 R', [{ num: 20, body: '<< /EmbeddedFiles << /Names [(a.txt) 21 0 R] >> >>' }, ...attachment])), 'pdf_embedded_file');
  assert.equal(activeFinding(withAnnotation('<< /Type /Annot /Subtype /RichMedia /Rect [0 0 5 5] >>')), 'pdf_rich_media');
  assert.equal(activeFinding(withCatalog('/AcroForm << /XFA [(template) 20 0 R] >>', [{ num: 20, body: '<< >>', stream: '<xdp/>' }])), 'pdf_xfa');
  assert.equal(activeFinding(linkWith('<< /S /SubmitForm /F (http://x.invalid/) >>')), 'pdf_submit_form');
  assert.equal(activeFinding(linkWith('<< /S /ImportData /F (data.fdf) >>')), 'pdf_import_data');
});

test('scanPdfStructure: smeće ispred %PDF- ne sakriva nalaz', () => {
  assert.equal(activeFinding(buildPdf([...basePdfObjects({ catalogExtra: `/OpenAction ${JS}` })], { prefix: 'smece smece\n' })), 'pdf_javascript');
});

test('scanPdfStructure: JavaScript u kompresovanom toku objekata (ObjStm) se vidi', () => {
  const link = linkWith(JS, { compress: [1, 2, 10, 20, 5] });
  // Zaista kompresovano: reč JavaScript se ne pojavljuje u sirovim bajtovima
  assert.equal(Buffer.from(link).includes('JavaScript'), false);
  assert.equal(activeFinding(link), 'pdf_javascript');
  assert.equal(activeFinding(linkWith('<< /S /Launch /F (a.exe) >>', { compress: [1, 2, 10, 20, 5] })), 'pdf_launch');
});

test('scanPdfStructure: aktivan sadržaj u šifrovanom PDF-u sa samo vlasničkom lozinkom (struktura je čitljiva)', () => {
  assert.equal(activeFinding(linkWith(JS, { encrypt: { userPassword: '' } })), 'pdf_javascript');
});

test('scanPdfStructure: nazivi koji samo liče (/JavaScripts, /JSON, /LaunchPad, /XFAx, /JS2) nisu nalaz', () => {
  for (const name of ['JavaScripts', 'JSON', 'LaunchPad', 'XFAx', 'JS2', 'Java', 'EmbeddedFileSpec', 'SubmitFormat', 'RichMediaX']) {
    assert.deepEqual(scanPdfStructure(linkWith(`<< /S /URI /${name} (x) >>`)), { kind: 'clean' }, name);
  }
});

test('scanPdfStructure: tekst "/JavaScript" u stringu, heks stringu i komentaru nije nalaz', () => {
  assert.deepEqual(scanPdfStructure(buildPdf(basePdfObjects({ catalogExtra: '/Lang (opis: /JavaScript /Launch)' }))), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(buildPdf(basePdfObjects({ catalogExtra: '/Lang (ugnjezdene (zagrade /JS) i \\) /Launch)' }))), { kind: 'clean' });
  const hexOf = (s: string) => Array.from(text(s), (b) => b.toString(16).padStart(2, '0')).join('');
  assert.deepEqual(scanPdfStructure(buildPdf(basePdfObjects({ catalogExtra: `/Lang <${hexOf('/JavaScript')}>` }))), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(buildPdf(basePdfObjects({ catalogExtra: '/Lang /sr % komentar /JavaScript /Launch\n' }))), { kind: 'clean' });
});

test('scanPdfStructure: tekst u sadržaju strane i binarni podaci u tokovima (slike) nikad nisu nalaz', () => {
  // Nasumični bajtovi sa mnogo "/JS " i "/Launch ": u pravoj slici to bi bio slučajan pogodak
  const noise = new Uint8Array(200_000);
  let x = 42;
  for (let i = 0; i < noise.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    noise[i] = (x >>> 16) & 0xff;
  }
  for (let at = 0; at + 12 < noise.length; at += 1000) noise.set(text('/JS /Launch '), at);
  const image: PdfObject = { num: 30, body: '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>', stream: noise };
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects({ text: '/JavaScript /Launch u ugovoru' }), image])), { kind: 'clean' });
});

test('scanPdfStructure: dekompresuje se samo ObjStm; običan Flate tok sa tekstom "/JavaScript" je čist', () => {
  const content: PdfObject = {
    num: 30,
    body: '<< /Filter /FlateDecode >>',
    stream: deflateSync(text('BT (opis /JavaScript /Launch /EmbeddedFile) Tj ET')),
  };
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), content])), { kind: 'clean' });
});

test('scanPdfStructure: ObjStm čiji bi raspakovani sadržaj prešao granicu je zip bomba za PDF', () => {
  const bomb: PdfObject = {
    num: 30,
    body: '<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode >>',
    stream: deflateSync(new Uint8Array(PDF_MAX_OBJECT_STREAM_BYTES + 1024)),
  };
  const r = scanPdfStructure(buildPdf([...basePdfObjects(), bomb]));
  assert.deepEqual(r, { kind: 'archive_bomb', finding: 'pdf_object_stream_too_large' });
});

test('scanPdfStructure: ObjStm sa nepoznatim filterom se preskače bez izuzetka', () => {
  const odd: PdfObject = { num: 30, body: '<< /Type /ObjStm /N 1 /First 5 /Filter /LZWDecode >>', stream: 'xxxxxxxx' };
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), odd])), { kind: 'clean' });
});

test('scanPdfStructure: oštećen ObjStm (nije ispravan deflate) se preskače bez izuzetka', () => {
  const broken: PdfObject = { num: 30, body: '<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode >>', stream: Uint8Array.from([1, 2, 3, 4, 5, 6, 7]) };
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), broken])), { kind: 'clean' });
});

test('scanPdfStructure: skraćen PDF, tekst i prazan niz ne ruše čitač', () => {
  assert.deepEqual(scanPdfStructure(new Uint8Array(0)), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(text('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Lang (nezatvoren')), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(text('%PDF-1.7\n1 0 obj\n<< /A <abcd')), { kind: 'clean' });
  assert.equal(activeFinding(text('%PDF-1.7\n1 0 obj\n<< /S /JavaScript /JS (x')), 'pdf_javascript');
  const cut = basePdf();
  assert.deepEqual(scanPdfStructure(cut.slice(0, 120)), { kind: 'clean' });
});

test('scanPdfStructure: ključna reč "stream" ispred kraja (bez endstream) ne zaglavljuje čitač', () => {
  assert.deepEqual(scanPdfStructure(text('%PDF-1.7\n1 0 obj\n<< >>\nstream\nbez kraja /JavaScript')), { kind: 'clean' });
});

// --- Sloj (b): ono što pdf.js zna o otvorenom dokumentu ---

async function inspect(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes.slice());
  try {
    return await inspectPdfDocument(pdf);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

test('inspectPdfDocument: običan PDF, PDF sa URI vezom i sa odredištem u OpenAction su čisti', async () => {
  assert.equal(await inspect(basePdf()), null);
  assert.equal(await inspect(basePdf({ catalogExtra: '/OpenAction [10 0 R /Fit]' })), null);
  assert.equal(await inspect(linkWith('<< /S /URI /URI (https://example.com/) >>')), null);
  assert.equal(await inspect(basePdf({ compress: [1, 2, 10, 5] })), null);
});

test('inspectPdfDocument: JavaScript u OpenAction i u stablu imena', async () => {
  assert.equal(await inspect(withCatalog(`/OpenAction ${JS}`)), 'pdf_javascript');
  assert.equal(await inspect(withCatalog('/Names 20 0 R', [{ num: 20, body: `<< /JavaScript << /Names [(a) ${JS}] >> >>` }])), 'pdf_javascript');
});

test('inspectPdfDocument: JavaScript u kompresovanom toku objekata (OpenAction)', async () => {
  const bytes = buildPdf([...basePdfObjects({ catalogExtra: '/OpenAction 20 0 R' }), { num: 20, body: JS }], { compress: [1, 20] });
  assert.equal(await inspect(bytes), 'pdf_javascript');
});

test('inspectPdfDocument: JavaScript u polju obrasca (widget)', async () => {
  const bytes = buildPdf([
    ...basePdfObjects({ catalogExtra: '/AcroForm << /Fields [20 0 R] >>', pageExtra: '/Annots [20 0 R]' }),
    { num: 20, body: `<< /Type /Annot /Subtype /Widget /FT /Tx /T (f) /Rect [0 0 50 50] /AA << /K ${JS} >> >>` },
  ]);
  assert.equal(await inspect(bytes), 'pdf_javascript');
});

test('inspectPdfDocument: ugrađeni fajlovi (stablo imena i anotacija priloga) i RichMedia', async () => {
  assert.equal(await inspect(withCatalog('/Names 20 0 R', [{ num: 20, body: '<< /EmbeddedFiles << /Names [(a.txt) 21 0 R] >> >>' }, ...attachment])), 'pdf_embedded_file');
  assert.equal(await inspect(withAnnotation('<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 5 5] /FS 21 0 R >>', attachment)), 'pdf_embedded_file');
  assert.equal(await inspect(withAnnotation('<< /Type /Annot /Subtype /RichMedia /Rect [0 0 5 5] >>')), 'pdf_rich_media');
});

test('inspectPdfDocument: anotacija priloga na drugoj strani se takođe vidi', async () => {
  const objects = basePdfObjects({ pages: 3 });
  const page3 = objects.find((o) => o.num === 14)!;
  page3.body = page3.body.replace(/ >>$/, ' /Annots [20 0 R] >>');
  const bytes = buildPdf([...objects, { num: 20, body: '<< /Type /Annot /Subtype /FileAttachment /Rect [0 0 5 5] /FS 21 0 R >>' }, ...attachment]);
  assert.equal(await inspect(bytes), 'pdf_embedded_file');
});

// --- Dopune: granice, imena i prerušeni zapisi ---

test('PDF_MAX_OBJECT_STREAM_BYTES je 50MB, a PDF_MAX_PAGES 300', () => {
  assert.equal(PDF_MAX_OBJECT_STREAM_BYTES, 50 * 1024 * 1024);
  assert.equal(PDF_MAX_PAGES, 300);
});

test('scanPdfStructure: /EmbeddedFiles bez fajla i zaostao /EmbeddedFile tok su svaki za sebe nalaz', () => {
  assert.equal(activeFinding(withCatalog('/Names 20 0 R', [{ num: 20, body: '<< /EmbeddedFiles << /Names [] >> >>' }])), 'pdf_embedded_file');
  assert.equal(activeFinding(buildPdf([...basePdfObjects(), { num: 22, body: '<< /Type /EmbeddedFile >>', stream: 'x' }])), 'pdf_embedded_file');
});

test('scanPdfStructure: heksadecimalne cifre u #xx mogu biti i mala slova (/#4a#53)', () => {
  assert.equal(activeFinding(linkWith('<< /#4a#53 (x) >>')), 'pdf_javascript');
  assert.equal(activeFinding(linkWith('<< /S /#4aava#53cript >>')), 'pdf_javascript');
});

test('scanPdfStructure: #xx koje nije ispravan heks zapis ostaje doslovno (/J#zzaScript nije JavaScript)', () => {
  assert.deepEqual(scanPdfStructure(linkWith('<< /S /J#zzaScript >>')), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(linkWith('<< /S /JS#5 >>')), { kind: 'clean' });
});

test('scanPdfStructure: imena ObjStm i FlateDecode iz jednog objekta ne prelaze na sledeći običan Flate tok', () => {
  const base = basePdfObjects({ catalogExtra: '/Foo << /Type /ObjStm /Filter /FlateDecode >>' });
  const content: PdfObject = { num: 30, body: '<< /Filter /FlateDecode >>', stream: deflateSync(text('BT << /S /JavaScript >> ET')) };
  assert.deepEqual(scanPdfStructure(buildPdf([base[0], content, ...base.slice(1)])), { kind: 'clean' });
});

test('scanPdfStructure: ObjStm bez endstream (skraćen fajl) se i dalje raspakuje', () => {
  const bytes = linkWith(JS, { compress: [1, 2, 10, 20, 5] });
  const buf = Buffer.from(bytes);
  const first = buf.indexOf('endstream');
  const second = buf.indexOf('endstream', first + 1);
  assert.ok(first > 0 && second > first);
  // Presečeno tačno na kraju deflate toka (bez završnog preloma reda), da se vidi da se poslednji bajt ne gubi
  assert.equal(activeFinding(bytes.slice(0, second - 1)), 'pdf_javascript');
});

test('scanPdfStructure: tok ugnježden u ObjStm je samo tekst (PDF čitač ga ne tumači), pa se ne raspakuje dalje', () => {
  const inner = deflateSync(text('<< /S /JavaScript >>'));
  const nested = Buffer.concat([
    text('1 0 obj\n<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode >>\nstream\n'),
    inner,
    text('\nendstream\nendobj\n'),
  ]);
  const outer: PdfObject = { num: 30, body: '<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode >>', stream: deflateSync(nested) };
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), outer])), { kind: 'clean' });
});

test('scanPdfStructure: budžet raspakivanja važi za zbir svih tokova objekata, ne za svaki posebno', () => {
  const half = deflateSync(new Uint8Array(30 * 1024 * 1024));
  const stream = (num: number): PdfObject => ({ num, body: '<< /Type /ObjStm /N 1 /First 5 /Filter /FlateDecode >>', stream: half });
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), stream(30)])), { kind: 'clean' });
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), stream(30), stream(31)])), {
    kind: 'archive_bomb',
    finding: 'pdf_object_stream_too_large',
  });
});

test('inspectPdfDocument: JavaScript akcija strane (/AA) i anotacija van AcroForm-a', async () => {
  assert.equal(await inspect(buildPdf(basePdfObjects({ pageExtra: `/AA << /O ${JS} >>` }))), 'pdf_javascript');
  const widget = '<< /Type /Annot /Subtype /Widget /FT /Tx /T (f) /Rect [0 0 50 50] /AA << /K ' + JS + ' >> >>';
  assert.equal(await inspect(withAnnotation(widget)), 'pdf_javascript');
});

test('scanPdfStructure: ObjStm bez ikakvog filtera (običan tekst objekata) se skenira kao i kompresovan', () => {
  const plainObjStm: PdfObject = {
    num: 30,
    body: '<< /Type /ObjStm /N 1 /First 5 >>',
    stream: '20 0 << /S /JavaScript /JS (x) >>',
  };
  assert.equal(activeFinding(buildPdf([...basePdfObjects(), plainObjStm])), 'pdf_javascript');
  const clean: PdfObject = { ...plainObjStm, stream: '20 0 << /S /URI /URI (https://example.com) >>' };
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), clean])), { kind: 'clean' });
});

test('inspectPdfDocument: polje obrasca sa JavaScript-om koje nije ni na jednoj strani se takođe vidi', async () => {
  const bytes = buildPdf([
    ...basePdfObjects({ catalogExtra: '/AcroForm << /Fields [20 0 R] >>' }),
    { num: 20, body: `<< /Type /Annot /Subtype /Widget /FT /Tx /T (f) /Rect [0 0 50 50] /AA << /K ${JS} >> >>` },
  ]);
  assert.equal(await inspect(bytes), 'pdf_javascript');
});

test('scanPdfStructure: ObjStm sa filterom koji ne čitamo (LZW) se ne skenira kao tekst: binarni podaci ne daju lažne pogotke', () => {
  const lzw: PdfObject = {
    num: 30,
    body: '<< /Type /ObjStm /N 1 /First 5 /Filter /LZWDecode >>',
    stream: new Uint8Array([...text('20 0 << /S /JavaScript >>')]),
  };
  assert.deepEqual(scanPdfStructure(buildPdf([...basePdfObjects(), lzw])), { kind: 'clean' });
});
