import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDocx } from './docx-read.ts';
import { buildDocx, buildZip } from './test-support/zip-builder.ts';

test('readDocx: ispravan .docx daje tekst', async () => {
  const r = await readDocx(buildDocx());
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.text.includes('Član 1. Ugovorne strane se saglašavaju o sledećem.'));
});

test('readDocx: ne menja bajtove pozivaoca', async () => {
  const bytes = buildDocx();
  const copy = bytes.slice();
  await readDocx(bytes);
  assert.deepEqual(bytes, copy);
});

test('readDocx: .docx bez ijednog pasusa je uspeh sa praznim tekstom (ruta ga odbija kao no_text)', async () => {
  const empty =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>';
  const r = await readDocx(buildDocx([{ name: 'word/document.xml', data: empty }]));
  assert.ok(r.ok && r.text.trim() === '');
});

test('readDocx: provera aktivnog sadržaja ide PRE čitanja (makro se odbija, tekst se ne vraća)', async () => {
  const r = await readDocx(buildDocx([{ name: 'word/vbaProject.bin', data: 'MZ' }]));
  assert.deepEqual(r, { ok: false, reason: 'active_content', finding: 'docx_macro' });
});

test('readDocx: zip bomba se odbija pre čitanja', async () => {
  const r = await readDocx(buildDocx([{ name: 'word/media/bomb.txt', data: new Uint8Array(60 * 1024 * 1024) }]));
  assert.deepEqual(r, { ok: false, reason: 'archive_bomb', finding: 'zip_uncompressed_size' });
});

test('readDocx: nevažeći XML u word/document.xml je unreadable_docx', async () => {
  const r = await readDocx(buildDocx([{ name: 'word/document.xml', data: '<w:document xmlns:w="x"><w:body><w:p>' }]));
  assert.deepEqual(r, { ok: false, reason: 'unreadable_docx', finding: 'mammoth_failed' });
});

test('readDocx: ZIP koji nije Word dokument (bez word/document.xml) je unreadable_docx', async () => {
  const r = await readDocx(buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }]));
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'unreadable_docx');
});

test('readDocx: bajtovi koji nisu ZIP su unreadable_docx', async () => {
  const r = await readDocx(new TextEncoder().encode('nije arhiva, ni približno ni malo'));
  assert.ok(!r.ok && r.reason === 'unreadable_docx');
});
