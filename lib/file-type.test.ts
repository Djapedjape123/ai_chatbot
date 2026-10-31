import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFileType } from './file-type.ts';
import { OLE_SIGNATURE, buildDocx, buildZip, joinBytes, utf16le } from './test-support/zip-builder.ts';

const text = (s: string) => new TextEncoder().encode(s);

test('detectFileType: PDF se prepoznaje po %PDF- na početku', () => {
  assert.equal(detectFileType(text('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')), 'pdf');
});

test('detectFileType: specifikacija dozvoljava smeće ispred %PDF- (do 1024 bajta)', () => {
  assert.equal(detectFileType(joinBytes(new Uint8Array(100).fill(0x20), text('%PDF-1.4\n'))), 'pdf');
});

test('detectFileType: %PDF- mora cela da stane u prvih 1024 bajta', () => {
  const at = (n: number) => joinBytes(new Uint8Array(n).fill(0x20), text('%PDF-1.4\n'));
  assert.equal(detectFileType(at(1019)), 'pdf'); // bajtovi 1019..1023
  assert.equal(detectFileType(at(1020)), 'unknown'); // prelazi granicu
  assert.equal(detectFileType(at(2000)), 'unknown');
});

test('detectFileType: tekst, HTML i skripta preimenovani u .pdf nisu PDF', () => {
  assert.equal(detectFileType(text('Ovo je običan tekst ugovora.')), 'unknown');
  assert.equal(detectFileType(text('<html><script>alert(1)</script></html>')), 'unknown');
  assert.equal(detectFileType(text('%PD')), 'unknown');
  assert.equal(detectFileType(text('%pdf-1.7')), 'unknown');
});

test('detectFileType: prazan niz je nepoznat', () => {
  assert.equal(detectFileType(new Uint8Array(0)), 'unknown');
});

test('detectFileType: ispravan .docx (ZIP sa [Content_Types].xml i word/document.xml)', () => {
  assert.equal(detectFileType(buildDocx()), 'docx');
});

test('detectFileType: ZIP bez word/document.xml nije .docx (xlsx, pptx, obična arhiva)', () => {
  assert.equal(detectFileType(buildZip([{ name: 'a.txt', data: 'x' }])), 'unknown');
  assert.equal(detectFileType(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'xl/workbook.xml', data: '<w/>' }])), 'unknown');
  assert.equal(detectFileType(buildZip([{ name: 'word/document.xml', data: '<w/>' }])), 'unknown');
  assert.equal(detectFileType(buildZip([])), 'unknown');
});

test('detectFileType: odlučuje centralni direktorijum, ne ono što lokalno zaglavlje tvrdi', () => {
  // Lokalno zaglavlje kaže "word/document.xml", a direktorijum (koji čita mammoth) govori drugo.
  const zip = buildZip([{ name: 'word/document.xml', data: '<w/>' }, { name: '[Content_Types].xml', data: '<Types/>' }]);
  const swapped = zip.slice();
  const dir = indexOf(swapped, text('PK\x01\x02'));
  const nameAt = dir + 46;
  swapped.set(text('word/documenX.xml'), nameAt);
  assert.equal(detectFileType(swapped), 'unknown');
});

test('detectFileType: imena stavki razlikuju mala i velika slova', () => {
  assert.equal(detectFileType(buildZip([{ name: '[content_types].xml', data: '<Types/>' }, { name: 'word/document.xml', data: '<w/>' }])), 'unknown');
  assert.equal(detectFileType(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'Word/Document.xml', data: '<w/>' }])), 'unknown');
});

test('detectFileType: oštećen ZIP (odsečen kraj) nije .docx', () => {
  const docx = buildDocx();
  assert.equal(detectFileType(docx.slice(0, docx.length - 5)), 'unknown');
});

test('detectFileType: ZIP koji u prvih 1024 bajta nosi %PDF- ostaje ZIP, nikad PDF (jedan tip = jedan parser)', () => {
  const polyglot = buildZip([{ name: 'a.txt', data: '%PDF-1.7 ovo je samo tekst u arhivi', method: 'store' }]);
  assert.notEqual(detectFileType(polyglot), 'pdf');
  const docxPolyglot = buildDocx([{ name: 'word/media/x.txt', data: '%PDF-1.7', method: 'store' }]);
  assert.equal(detectFileType(docxPolyglot), 'docx');
});

test('detectFileType: OLE potpis je star .doc (ili šifrovan Office fajl)', () => {
  assert.equal(detectFileType(joinBytes(OLE_SIGNATURE, new Uint8Array(512))), 'legacy_doc');
});

test('detectFileType: OLE sa tokom EncryptedPackage je šifrovan Office fajl (.docx sa lozinkom)', () => {
  const encrypted = joinBytes(OLE_SIGNATURE, new Uint8Array(900), utf16le('EncryptionInfo'), new Uint8Array(40), utf16le('EncryptedPackage'));
  assert.equal(detectFileType(encrypted), 'encrypted_office');
});

test('detectFileType: OLE koji samo pominje reč u običnom (ASCII) tekstu nije šifrovan', () => {
  assert.equal(detectFileType(joinBytes(OLE_SIGNATURE, text('EncryptedPackage'))), 'legacy_doc');
});

test('detectFileType: samo deo OLE potpisa nije OLE', () => {
  assert.equal(detectFileType(OLE_SIGNATURE.slice(0, 7)), 'unknown');
});

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) continue outer;
    return i;
  }
  throw new Error('nije nađeno');
}

test('detectFileType: potpis koji tačno popunjava fajl (bez ijednog bajta više) se prepoznaje', () => {
  assert.equal(detectFileType(text('%PDF-')), 'pdf');
  assert.equal(detectFileType(OLE_SIGNATURE.slice()), 'legacy_doc');
});
