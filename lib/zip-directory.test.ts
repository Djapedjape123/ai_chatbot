import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZipDirectory } from './zip-directory.ts';
import { buildZip, joinBytes } from './test-support/zip-builder.ts';

const hello = 'zdravo zdravo zdravo zdravo zdravo zdravo zdravo zdravo';

test('readZipDirectory: čita imena, metod i veličine svih stavki, redom iz direktorijuma', () => {
  const zip = buildZip([
    { name: 'a.txt', data: hello },
    { name: 'dir/b.txt', data: 'bbb', method: 'store' },
  ]);
  const entries = readZipDirectory(zip);
  assert.ok(entries);
  assert.deepEqual(
    entries.map((e) => [e.name, e.method, e.uncompressedSize]),
    [
      ['a.txt', 8, hello.length],
      ['dir/b.txt', 0, 3],
    ]
  );
  assert.ok(entries[0].compressedSize < entries[0].uncompressedSize);
  assert.equal(entries[1].compressedSize, 3);
});

test('readZipDirectory: ime u UTF-8 se čita ispravno', () => {
  const entries = readZipDirectory(buildZip([{ name: 'word/šđčćž.xml', data: 'x' }]));
  assert.equal(entries?.[0].name, 'word/šđčćž.xml');
});

test('readZipDirectory: čita i arhivu bez ijedne stavke', () => {
  assert.deepEqual(readZipDirectory(buildZip([])), []);
});

test('readZipDirectory: komentar arhive koji sadrži lažan EOCD potpis ne zbunjuje čitač', () => {
  const zip = buildZip([{ name: 'a.txt', data: 'x' }], { comment: 'PK\x05\x06 lažni komentar PK\x05\x06' });
  const entries = readZipDirectory(zip);
  assert.deepEqual(entries?.map((e) => e.name), ['a.txt']);
});

test('readZipDirectory: prazan niz, nasumični bajtovi i običan tekst nisu ZIP', () => {
  assert.equal(readZipDirectory(new Uint8Array(0)), null);
  assert.equal(readZipDirectory(new TextEncoder().encode('ovo je običan tekst, nije arhiva, ni približno')), null);
  assert.equal(readZipDirectory(new Uint8Array(500).fill(7)), null);
});

test('readZipDirectory: odsečen kraj arhive (nema EOCD) nije ZIP', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  assert.equal(readZipDirectory(zip.slice(0, zip.length - 10)), null);
});

test('readZipDirectory: centralni direktorijum koji pokazuje van fajla nije ZIP', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }], { centralDirectoryOffset: 5_000_000 });
  assert.equal(readZipDirectory(zip), null);
});

test('readZipDirectory: ZIP64 oznake se odbijaju (sa 4MB ograničenja legitiman fajl ih nema)', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }], { centralDirectoryOffset: 0xffffffff });
  assert.equal(readZipDirectory(zip), null);
  const many = buildZip([{ name: 'a.txt', data: hello }], { declaredEntryCount: 0xffff });
  assert.equal(readZipDirectory(many), null);
});

test('readZipDirectory: broj stavki u EOCD-u veći od onoga što direktorijum nosi nije ZIP', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }], { declaredEntryCount: 3 });
  assert.equal(readZipDirectory(zip), null);
});

test('readZipDirectory: stavka sa pogrešnim potpisom u direktorijumu nije ZIP', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  const at = findSignature(zip, [0x50, 0x4b, 0x01, 0x02]);
  const broken = zip.slice();
  broken[at + 2] = 0x09;
  assert.equal(readZipDirectory(broken), null);
});

test('readZipDirectory: ime koje prelazi kraj direktorijuma nije ZIP', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  const at = findSignature(zip, [0x50, 0x4b, 0x01, 0x02]);
  const broken = zip.slice();
  broken[at + 28] = 0xff; // dužina imena
  broken[at + 29] = 0x7f;
  assert.equal(readZipDirectory(broken), null);
});

test('readZipDirectory: smeće ispred arhive se odbija (strogo: drugi čitači bi mogli da vide drugačiji direktorijum)', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  assert.equal(readZipDirectory(joinBytes(new TextEncoder().encode('smeće'), zip)), null);
});

test('readZipDirectory: razmak između direktorijuma i EOCD-a se odbija', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  const at = findSignature(zip, [0x50, 0x4b, 0x05, 0x06]);
  const gap = joinBytes(zip.slice(0, at), new Uint8Array(7), zip.slice(at));
  assert.equal(readZipDirectory(gap), null);
});

function findSignature(bytes: Uint8Array, sig: number[]): number {
  for (let i = bytes.length - sig.length; i >= 0; i--) {
    if (sig.every((b, k) => bytes[i + k] === b)) return i;
  }
  throw new Error('potpis nije nađen');
}

test('readZipDirectory: višediskovna arhiva se odbija', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  const at = findSignature(zip, [0x50, 0x4b, 0x05, 0x06]);
  const split = zip.slice();
  split[at + 4] = 1; // broj diska
  assert.equal(readZipDirectory(split), null);
  const otherDisk = zip.slice();
  otherDisk[at + 6] = 1; // disk sa direktorijumom
  assert.equal(readZipDirectory(otherDisk), null);
});

test('readZipDirectory: ZIP64 oznake u samoj stavci (veličina 0xffffffff) se odbijaju', () => {
  assert.equal(readZipDirectory(buildZip([{ name: 'a.txt', data: hello, declaredUncompressedSize: 0xffffffff }])), null);
  assert.equal(readZipDirectory(buildZip([{ name: 'a.txt', data: hello, declaredCompressedSize: 0xffffffff }])), null);
});

test('readZipDirectory: lokalno zaglavlje koje pokazuje na direktorijum ili posle njega se odbija', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  const at = findSignature(zip, [0x50, 0x4b, 0x01, 0x02]);
  const broken = zip.slice();
  new DataView(broken.buffer).setUint32(at + 42, at, true);
  assert.equal(readZipDirectory(broken), null);
});

test('readZipDirectory: broj stavki u EOCD-u manji od onoga što direktorijum nosi se odbija (višak bajtova)', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }, { name: 'b.txt', data: hello }], { declaredEntryCount: 1 });
  assert.equal(readZipDirectory(zip), null);
  assert.equal(readZipDirectory(buildZip([{ name: 'a.txt', data: hello }], { declaredEntryCount: 0 })), null);
});

test('readZipDirectory: broj stavki na ovom disku različit od ukupnog broja se odbija', () => {
  const zip = buildZip([{ name: 'a.txt', data: hello }]);
  const at = findSignature(zip, [0x50, 0x4b, 0x05, 0x06]);
  const broken = zip.slice();
  broken[at + 8] = 5;
  assert.equal(readZipDirectory(broken), null);
});
