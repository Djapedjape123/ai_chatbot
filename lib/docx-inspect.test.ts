import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCX_MAX_ENTRIES,
  DOCX_MAX_RATIO,
  DOCX_MAX_UNCOMPRESSED,
  inspectDocx,
} from './docx-inspect.ts';
import { readZipDirectory } from './zip-directory.ts';
import { buildDocx, buildZip, joinBytes, utf16le, type ZipSpecEntry } from './test-support/zip-builder.ts';

const RELS_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

function rels(body: string, name = 'word/_rels/settings.xml.rels'): ZipSpecEntry {
  return { name, data: `${RELS_HEAD}${body}</Relationships>` };
}

function externalRel(type: string, extra = ''): string {
  return `<Relationship Id="rId9" Type="${REL_TYPE}${type}" Target="http://primer.invalid/x" TargetMode="External"${extra}/>`;
}

function reject(bytes: Uint8Array) {
  const r = inspectDocx(bytes);
  assert.equal(r.ok, false, 'fajl je trebalo da bude odbijen');
  return r as Exclude<typeof r, { ok: true }>;
}

// --- Ispravni fajlovi MORAJU da prolaze (lažno pozitivni) ---

test('inspectDocx: najmanji ispravan .docx prolazi', () => {
  assert.deepEqual(inspectDocx(buildDocx()), { ok: true });
});

test('inspectDocx: obična spoljna veza (hyperlink) i spoljna slika su dozvoljeni', () => {
  const doc = buildDocx([
    rels(externalRel('hyperlink') + externalRel('image'), 'word/_rels/document.xml.rels'),
    { name: 'word/media/image1.png', data: new Uint8Array([1, 2, 3, 4]), method: 'store' },
    { name: 'word/styles.xml', data: '<w:styles/>' },
    { name: 'docProps/core.xml', data: '<cp:coreProperties/>' },
  ]);
  assert.deepEqual(inspectDocx(doc), { ok: true });
});

test('inspectDocx: unutrašnja veza sa tipom attachedTemplate nije udaljeno učitavanje', () => {
  const internal = `<Relationship Id="rId2" Type="${REL_TYPE}attachedTemplate" Target="template.dotx"/>`;
  assert.deepEqual(inspectDocx(buildDocx([rels(internal)])), { ok: true });
});

test('inspectDocx: ugrađena Excel tabela (.xlsx u embeddings) nije .bin objekat pa prolazi', () => {
  const doc = buildDocx([{ name: 'word/embeddings/Microsoft_Excel_Worksheet.xlsx', data: 'PK', method: 'store' }]);
  assert.deepEqual(inspectDocx(doc), { ok: true });
});

test('inspectDocx: velik pravi dokument (stotine KB teksta, odnos ispod granice) prolazi', () => {
  const paragraphs = Array.from(
    { length: 6000 },
    (_, i) => `<w:p><w:r><w:t>Član ${i}. Ugovorne strane se saglašavaju o stavu ${(i * 7919) % 10007} ovog ugovora.</w:t></w:r></w:p>`
  );
  const big = new TextEncoder().encode(paragraphs.join(''));
  const doc = buildDocx([{ name: 'word/document.xml', data: big }]);
  const entry = readZipDirectory(doc)!.find((e) => e.name === 'word/document.xml')!;
  assert.ok(entry.uncompressedSize >= 64 * 1024, 'uzorak mora biti dovoljno velik da se odnos uopšte proverava');
  assert.ok(entry.uncompressedSize / entry.compressedSize < DOCX_MAX_RATIO, 'uzorak mora biti ispod granice odnosa');
  assert.deepEqual(inspectDocx(doc), { ok: true });
});

test('inspectDocx: mala stavka sa visokim odnosom (nule) ne može da naškodi i prolazi', () => {
  const doc = buildDocx([{ name: 'word/media/blank.bin.txt', data: new Uint8Array(20_000) }]);
  assert.deepEqual(inspectDocx(doc), { ok: true });
});

// --- Aktivan sadržaj ---

test('inspectDocx: makro projekat (word/vbaProject.bin) se odbija', () => {
  const r = reject(buildDocx([{ name: 'word/vbaProject.bin', data: 'MZ' }]));
  assert.equal(r.reason, 'active_content');
  assert.equal(r.finding, 'docx_macro');
});

test('inspectDocx: .docm preimenovan u .docx (macroEnabled u [Content_Types].xml) se odbija', () => {
  const types =
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>';
  const r = reject(buildDocx([{ name: '[Content_Types].xml', data: types }]));
  assert.equal(r.reason, 'active_content');
  assert.equal(r.finding, 'docx_macro');
});

test('inspectDocx: makro se hvata i kad je ime stavke prerušeno (velika slova, obrnuta kosa crta, %-kodiranje)', () => {
  for (const name of ['word/VBAPROJECT.BIN', 'word\\vbaProject.bin', 'word/vba%50roject.bin', 'word/vbaData.xml', 'word/_rels/vbaProject.bin.rels']) {
    const r = reject(buildDocx([{ name, data: 'x' }]));
    assert.equal(r.finding, 'docx_macro', name);
  }
});

test('inspectDocx: ugrađeni OLE objekat (.bin u word/embeddings, oleObject) se odbija', () => {
  for (const name of ['word/embeddings/oleObject1.bin', 'word/embeddings/Equation1.bin', 'word/oleObject2.bin', 'word/Embeddings/Pack.BIN', 'word\\embeddings\\Eq.bin']) {
    const r = reject(buildDocx([{ name, data: 'x' }]));
    assert.equal(r.reason, 'active_content', name);
    assert.equal(r.finding, 'docx_embedded_object', name);
  }
});

test('inspectDocx: ActiveX kontrole se odbijaju', () => {
  for (const name of ['word/activeX/activeX1.xml', 'word/activeX/activeX1.bin', 'word/ActiveX/x.xml', 'word\\activeX\\activeX1.xml']) {
    const r = reject(buildDocx([{ name, data: 'x' }]));
    assert.equal(r.finding, 'docx_activex', name);
  }
});

test('inspectDocx: udaljeni šablon (attachedTemplate, TargetMode=External) se odbija', () => {
  const r = reject(buildDocx([rels(externalRel('attachedTemplate'))]));
  assert.equal(r.reason, 'active_content');
  assert.equal(r.finding, 'docx_remote_template');
});

test('inspectDocx: udaljeni oleObject i frame se odbijaju', () => {
  assert.equal(reject(buildDocx([rels(externalRel('oleObject'))])).finding, 'docx_remote_object');
  assert.equal(reject(buildDocx([rels(externalRel('frame'))])).finding, 'docx_remote_frame');
});

test('inspectDocx: udaljena veza se hvata i kad se piše drugačije (jednostruki navodnici, redosled atributa, mala slova)', () => {
  const swapped = `<Relationship TargetMode='external' Target='http://x.invalid/t.dotm' Type='${REL_TYPE}ATTACHEDTEMPLATE' Id='r1'/>`;
  assert.equal(reject(buildDocx([rels(swapped)])).finding, 'docx_remote_template');
});

test('inspectDocx: udaljena veza se hvata i kad je TargetMode zapisan XML entitetima (&#69;xternal)', () => {
  const encoded = `<Relationship Id="r1" Type="${REL_TYPE}attachedTemplate" Target="http://x.invalid/t.dotm" TargetMode="&#69;xternal"/>`;
  assert.equal(reject(buildDocx([rels(encoded)])).finding, 'docx_remote_template');
  const hex = `<Relationship Id="r1" Type="${REL_TYPE}attached&#x54;emplate" Target="http://x.invalid/t.dotm" TargetMode="External"/>`;
  assert.equal(reject(buildDocx([rels(hex)])).finding, 'docx_remote_template');
});

test('inspectDocx: ">" u vrednosti atributa ne sakriva TargetMode od provere', () => {
  const tricky = `<Relationship Id="a>b" Type="${REL_TYPE}attachedTemplate" Target="http://x.invalid/t.dotm" TargetMode="External"/>`;
  assert.equal(reject(buildDocx([rels(tricky)])).finding, 'docx_remote_template');
});

test('inspectDocx: veza sa prefiksom prostora imena (r:Relationship) se takođe proverava', () => {
  const prefixed = `<r:Relationship Id="r1" Type="${REL_TYPE}attachedTemplate" Target="http://x.invalid/t.dotm" TargetMode="External"/>`;
  assert.equal(reject(buildDocx([rels(prefixed)])).finding, 'docx_remote_template');
});

test('inspectDocx: .rels u UTF-16 (sa BOM-om) se čita, pa se udaljeni šablon ne sakriva kodiranjem', () => {
  const text = `${RELS_HEAD}${externalRel('attachedTemplate')}</Relationships>`;
  const le = joinBytes(Uint8Array.from([0xff, 0xfe]), utf16le(text));
  assert.equal(reject(buildDocx([{ name: 'word/_rels/settings.xml.rels', data: le }])).finding, 'docx_remote_template');
  const be = new Uint8Array(text.length * 2 + 2);
  be.set([0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) be.set([text.charCodeAt(i) >>> 8, text.charCodeAt(i) & 0xff], 2 + i * 2);
  assert.equal(reject(buildDocx([{ name: 'word/_rels/settings.xml.rels', data: be }])).finding, 'docx_remote_template');
});

test('inspectDocx: .rels van word/_rels (npr. glavni _rels/.rels) se takođe proverava', () => {
  const r = reject(buildDocx([rels(externalRel('attachedTemplate'), '_rels/.rels')]));
  assert.equal(r.finding, 'docx_remote_template');
});

// --- Zip bomba ---

test('inspectDocx: granice su one iz plana (50MB, 2000 stavki, odnos 100)', () => {
  assert.equal(DOCX_MAX_UNCOMPRESSED, 50 * 1024 * 1024);
  assert.equal(DOCX_MAX_ENTRIES, 2000);
  assert.equal(DOCX_MAX_RATIO, 100);
});

test('inspectDocx: previše stavki je zip bomba', () => {
  const many: ZipSpecEntry[] = Array.from({ length: DOCX_MAX_ENTRIES + 1 }, (_, i) => ({ name: `word/media/f${i}.txt`, data: 'x', method: 'store' }));
  const r = reject(buildDocx(many));
  assert.equal(r.reason, 'archive_bomb');
  assert.equal(r.finding, 'zip_entries');
});

test('inspectDocx: tačno 2000 stavki još prolazi', () => {
  const extra = DOCX_MAX_ENTRIES - 3; // buildDocx već nosi 3 stavke
  const many: ZipSpecEntry[] = Array.from({ length: extra }, (_, i) => ({ name: `word/media/f${i}.txt`, data: 'x', method: 'store' }));
  const doc = buildDocx(many);
  assert.equal(readZipDirectory(doc)!.length, DOCX_MAX_ENTRIES);
  assert.deepEqual(inspectDocx(doc), { ok: true });
});

test('inspectDocx: stvarna bomba (60MB nula u par KB) se odbija po zbiru raspakovanih veličina', () => {
  const bomb = buildDocx([{ name: 'word/media/bomb.bin.txt', data: new Uint8Array(60 * 1024 * 1024) }]);
  assert.ok(bomb.length < 200_000, 'uzorak mora biti mali');
  const r = reject(bomb);
  assert.equal(r.reason, 'archive_bomb');
  assert.equal(r.finding, 'zip_uncompressed_size');
});

test('inspectDocx: zbir deklarisanih veličina preko granice se odbija i bez raspakivanja (laža u zaglavlju)', () => {
  const r = reject(buildDocx([{ name: 'word/media/a.txt', data: 'x', declaredUncompressedSize: DOCX_MAX_UNCOMPRESSED + 1 }]));
  assert.equal(r.reason, 'archive_bomb');
  assert.equal(r.finding, 'zip_uncompressed_size');
});

test('inspectDocx: visok odnos raspakovano/spakovano na velikoj stavci je zip bomba', () => {
  const r = reject(buildDocx([{ name: 'word/media/zeros.txt', data: new Uint8Array(8 * 1024 * 1024) }]));
  assert.equal(r.reason, 'archive_bomb');
  assert.equal(r.finding, 'zip_ratio');
});

test('inspectDocx: zaglavlje koje laže da je stavka mala, a stvarno je velika, se hvata (mismatch)', () => {
  const r = reject(buildDocx([{ name: 'word/media/liar.txt', data: new Uint8Array(3 * 1024 * 1024), declaredUncompressedSize: 1000 }]));
  assert.equal(r.reason, 'archive_bomb');
  assert.equal(r.finding, 'zip_size_mismatch');
});

test('inspectDocx: zaglavlje koje laže da je stavka velika, a stvarno je mala, se takođe odbija', () => {
  const r = reject(buildDocx([{ name: 'word/media/liar.txt', data: 'kratko', declaredUncompressedSize: 5000 }]));
  assert.equal(r.reason, 'archive_bomb');
  assert.equal(r.finding, 'zip_size_mismatch');
});

// --- Oštećeni i neobični fajlovi ---

test('inspectDocx: oštećen deflate tok je neispravan .docx', () => {
  const r = reject(buildDocx([{ name: 'word/document.xml', data: '<w:document/>', packedBytes: Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff]) }]));
  assert.equal(r.reason, 'unreadable_docx');
});

test('inspectDocx: šifrovana ZIP stavka i nepoznat metod kompresije su neispravan .docx', () => {
  assert.equal(reject(buildDocx([{ name: 'word/styles.xml', data: 'x', flags: 0x0001 }])).reason, 'unreadable_docx');
  assert.equal(reject(buildDocx([{ name: 'word/styles.xml', data: 'x', methodCode: 99 }])).reason, 'unreadable_docx');
});

test('inspectDocx: lokalno zaglavlje sa lošim potpisom je neispravan .docx', () => {
  assert.equal(reject(buildDocx([{ name: 'word/styles.xml', data: 'x', badLocalSignature: true }])).reason, 'unreadable_docx');
});

test('inspectDocx: podaci koji izlaze van fajla su neispravan .docx', () => {
  const r = reject(buildDocx([{ name: 'word/styles.xml', data: 'x', declaredCompressedSize: 9_000_000, declaredUncompressedSize: 1 }]));
  assert.equal(r.reason, 'unreadable_docx');
});

test('inspectDocx: bajtovi koji uopšte nisu ZIP su neispravan .docx', () => {
  assert.equal(reject(new TextEncoder().encode('ovo nije arhiva, ni približno, ni malo')).reason, 'unreadable_docx');
  assert.equal(reject(buildZip([]).slice(0, 10)).reason, 'unreadable_docx');
});

// --- Dopune granica i prerušenih zapisa ---

test('inspectDocx: macroEnabled se hvata i kad je zapisan XML entitetom, a tip bin/vbaProject i bez same stavke', () => {
  const encoded =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macro&#69;nabled.main+xml"/></Types>';
  assert.equal(reject(buildDocx([{ name: '[Content_Types].xml', data: encoded }])).finding, 'docx_macro');

  const vba =
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>';
  assert.equal(reject(buildDocx([{ name: '[Content_Types].xml', data: vba }])).finding, 'docx_macro');
});

test('inspectDocx: .rels bez BOM-a u UTF-16 (LE i BE) se takođe čita', () => {
  const text = `${RELS_HEAD}${externalRel('attachedTemplate')}</Relationships>`;
  assert.equal(reject(buildDocx([{ name: 'word/_rels/settings.xml.rels', data: utf16le(text) }])).finding, 'docx_remote_template');
  const be = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) be.set([text.charCodeAt(i) >>> 8, text.charCodeAt(i) & 0xff], i * 2);
  assert.equal(reject(buildDocx([{ name: 'word/_rels/settings.xml.rels', data: be }])).finding, 'docx_remote_template');
});

test('inspectDocx: ogroman numerički entitet (&#9999999;) ne ruši proveru i ne sakriva vezu', () => {
  const rel = `<Relationship Id="r&#9999999;1" Type="${REL_TYPE}attachedTemplate" Target="http://x.invalid/t.dotm" TargetMode="External"/>`;
  assert.equal(reject(buildDocx([rels(rel)])).finding, 'docx_remote_template');
});

test('inspectDocx: navodnik u komentaru ili instrukciji ispred veze ne sakriva vezu', () => {
  const link = externalRel('attachedTemplate');
  assert.equal(reject(buildDocx([rels(`<!-- a=" -->${link}`)])).finding, 'docx_remote_template');
  assert.equal(reject(buildDocx([rels(`<?pi a=" ?>${link}`)])).finding, 'docx_remote_template');
});

test('inspectDocx: veza koja je samo tekst u komentaru ili CDATA nije veza (XML parser je ne vidi)', () => {
  const fake = externalRel('attachedTemplate');
  assert.deepEqual(inspectDocx(buildDocx([rels(`<!-- ${fake} -->`)])), { ok: true });
  assert.deepEqual(inspectDocx(buildDocx([rels(`<![CDATA[${fake}]]>`)])), { ok: true });
  // ">" ispred lažne veze ne sme da "otvori" komentar/CDATA ranije nego što se zatvara
  assert.deepEqual(inspectDocx(buildDocx([rels(`<!-- a > ${fake} -->`)])), { ok: true });
  assert.deepEqual(inspectDocx(buildDocx([rels(`<![CDATA[ a > ${fake} ]]>`)])), { ok: true });
});

test('inspectDocx: nezatvoren navodnik u vezi ne zaglavljuje proveru, a ispravna veza posle njega se i dalje vidi', () => {
  const link = externalRel('attachedTemplate');
  const r = reject(buildDocx([rels(`<Relationship Id="a" Type="x/hyperlink" Target="http://ok.invalid/"  TargetMode="External"/>${link}<Relationship Id="b`)]));
  assert.equal(r.finding, 'docx_remote_template');
});

test('inspectDocx: DTD u .rels ili Content Types se odbija (Office paket ga ne sme imati)', () => {
  const dtd = '<!DOCTYPE Relationships [<!ENTITY e "External">]>';
  const r = reject(buildDocx([{ name: 'word/_rels/settings.xml.rels', data: `${dtd}${RELS_HEAD}</Relationships>` }]));
  assert.equal(r.reason, 'unreadable_docx');
  assert.equal(r.finding, 'xml_dtd');
});

test('inspectDocx: preveliki .rels (preko 5MB) nije običan Word fajl', () => {
  // Bajtovi bez ponavljanja, da odnos kompresije ne obori fajl ranije
  const noise = new Uint8Array(5 * 1024 * 1024 + 10);
  let x = 123456789;
  for (let i = 0; i < noise.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    noise[i] = (x >>> 16) & 0xff;
  }
  const r = reject(buildDocx([{ name: 'word/_rels/huge.xml.rels', data: noise }]));
  assert.equal(r.reason, 'unreadable_docx');
  assert.equal(r.finding, 'xml_part_too_large');
});

test('inspectDocx: prazna stavka (0 bajtova, kao prazan folder ili prazna slika) prolazi', () => {
  assert.deepEqual(inspectDocx(buildDocx([{ name: 'word/media/empty.png', data: '' }, { name: 'word/media/', data: '', method: 'store' }])), { ok: true });
});

test('inspectDocx: stavka bez kompresije čije se deklarisane veličine ne slažu je zaglavlje koje laže', () => {
  const r = reject(buildDocx([{ name: 'word/media/a.png', data: 'abcd', method: 'store', declaredUncompressedSize: 10 }]));
  assert.equal(r.reason, 'archive_bomb');
  assert.equal(r.finding, 'zip_size_mismatch');
});

test('inspectDocx: podaci van fajla se prijavljuju kao takvi (ne kao oštećen tok)', () => {
  const r = reject(buildDocx([{ name: 'word/styles.xml', data: 'x', declaredCompressedSize: 9_000_000, declaredUncompressedSize: 1 }]));
  assert.equal(r.finding, 'zip_data_out_of_range');
});

test('inspectDocx: granica zbira raspakovanih veličina je tačno 50MB (50MB prolazi proveru zbira, 50MB+1 ne)', () => {
  const declaredBase = readZipDirectory(buildDocx())!.reduce((sum, e) => sum + e.uncompressedSize, 0);
  // Veličina se laže, pa fajl na kraju ipak pada, ali NE po zbiru: tako se vidi na kojoj je strani granica
  const atLimit = reject(buildDocx([{ name: 'word/media/pad.txt', data: 'x', declaredUncompressedSize: DOCX_MAX_UNCOMPRESSED - declaredBase }]));
  assert.notEqual(atLimit.finding, 'zip_uncompressed_size');
  const over = reject(buildDocx([{ name: 'word/media/pad.txt', data: 'x', declaredUncompressedSize: DOCX_MAX_UNCOMPRESSED - declaredBase + 1 }]));
  assert.equal(over.finding, 'zip_uncompressed_size');
});

test('inspectDocx: odnos se proverava od stavke od 64KB naviše (65535 prolazi, 65536 ne)', () => {
  assert.deepEqual(inspectDocx(buildDocx([{ name: 'word/media/z.txt', data: new Uint8Array(65_535) }])), { ok: true });
  const r = reject(buildDocx([{ name: 'word/media/z.txt', data: new Uint8Array(65_536) }]));
  assert.equal(r.finding, 'zip_ratio');
});

test('inspectDocx: granica odnosa je tačno 100 (100:1 prolazi proveru odnosa, 100,001:1 ne)', () => {
  // Zaglavlja lažu, pa fajl pada kasnije, ali ne po odnosu: tako se vidi na kojoj je strani granica
  const atLimit = reject(buildDocx([{ name: 'word/media/r.txt', data: 'x', declaredUncompressedSize: 100_000, declaredCompressedSize: 1000 }]));
  assert.notEqual(atLimit.finding, 'zip_ratio');
  const over = reject(buildDocx([{ name: 'word/media/r.txt', data: 'x', declaredUncompressedSize: 100_001, declaredCompressedSize: 1000 }]));
  assert.equal(over.finding, 'zip_ratio');
});
