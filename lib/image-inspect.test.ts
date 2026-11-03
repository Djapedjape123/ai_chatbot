import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectJpeg } from './image-inspect.ts';
import {
  CLIENT_TARGET_BYTES,
  CLIENT_TARGET_LONG_EDGE,
  IMAGES_MAX_TOTAL_BYTES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_LONG_EDGE,
  IMAGE_MIN_LONG_EDGE,
  MAX_DOCUMENT_PAGES,
  MAX_IMAGES_PER_QUESTION,
} from './image-limits.ts';
import {
  COMMENT,
  DEFAULT_SCAN_DATA,
  DHT,
  EXIF_GPS_APP1,
  ICC_APP2,
  JFIF_APP0,
  PHOTOSHOP_APP13,
  buildJpeg,
  containsText,
  segment,
} from './test-support/jpeg-builder.ts';
import { buildDocx, joinBytes } from './test-support/zip-builder.ts';

const text = (s: string) => new TextEncoder().encode(s);

function ok(bytes: Uint8Array) {
  const r = inspectJpeg(bytes);
  if (!r.ok) assert.fail(`očekivan uspeh, a dobijeno ${r.reason}${'finding' in r ? ` (${r.finding})` : ''}`);
  return r;
}

function rejected(bytes: Uint8Array, reason: string, finding?: string) {
  const r = inspectJpeg(bytes);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, reason);
  if (finding !== undefined) assert.equal('finding' in r ? r.finding : undefined, finding);
}

test('inspectJpeg: ispravan baseline JPEG prolazi sa dimenzijama iz SOF-a', () => {
  const r = ok(buildJpeg({ width: 1568, height: 1176 }));
  assert.equal(r.width, 1568);
  assert.equal(r.height, 1176);
});

test('inspectJpeg: JPEG bez metapodataka ostaje bajt po bajt isti', () => {
  const input = buildJpeg();
  assert.deepEqual(ok(input).bytes, input);
});

test('inspectJpeg: EXIF sa GPS lokacijom se uklanja, ostatak ostaje isti', () => {
  const clean = buildJpeg();
  const withExif = buildJpeg({ before: [EXIF_GPS_APP1] });
  const r = ok(withExif);
  assert.ok(containsText(withExif, 'GPSLatitude'));
  assert.equal(containsText(r.bytes, 'GPSLatitude'), false);
  assert.equal(containsText(r.bytes, 'Exif'), false);
  assert.deepEqual(r.bytes, clean);
});

test('inspectJpeg: uklanjaju se svi APP0-APP15 i COM segmenti (JFIF, ICC, Photoshop, komentar)', () => {
  const clean = buildJpeg();
  const r = ok(buildJpeg({ before: [JFIF_APP0, EXIF_GPS_APP1, ICC_APP2, PHOTOSHOP_APP13, COMMENT, { marker: 0xef, data: 'app15' }] }));
  assert.deepEqual(r.bytes, clean);
  for (const t of ['JFIF', 'ICC_PROFILE', 'Photoshop', 'klijenta', 'app15']) assert.equal(containsText(r.bytes, t), false, t);
});

test('inspectJpeg: metapodaci posle SOF-a i između skenova (progressive) se takođe uklanjaju', () => {
  const clean = buildJpeg({ sofMarker: 0xc2, scans: 3, betweenScans: [{ raw: DHT }] });
  const dirty = buildJpeg({
    sofMarker: 0xc2,
    scans: 3,
    afterFrame: [COMMENT],
    betweenScans: [EXIF_GPS_APP1, { raw: DHT }],
  });
  const r = ok(dirty);
  assert.deepEqual(r.bytes, clean);
  assert.equal(containsText(r.bytes, 'GPSLatitude'), false);
});

test('inspectJpeg: ulazni niz se ne menja', () => {
  const input = buildJpeg({ before: [EXIF_GPS_APP1] });
  const copy = input.slice();
  ok(input);
  assert.deepEqual(input, copy);
});

test('inspectJpeg: progressive JPEG (SOF2) sa više skenova prolazi', () => {
  const r = ok(buildJpeg({ sofMarker: 0xc2, scans: 4, betweenScans: [{ raw: DHT }] }));
  assert.equal(r.width, 1200);
});

test('inspectJpeg: SOF1 (extended sequential) prolazi', () => {
  ok(buildJpeg({ sofMarker: 0xc1 }));
});

test('inspectJpeg: siva slika (1 komponenta) prolazi', () => {
  ok(buildJpeg({ components: 1 }));
});

test('inspectJpeg: bajtovi za popunu (FF FF) ispred markera su dozvoljeni', () => {
  const input = buildJpeg();
  // Ubacujemo FF ispred DQT markera (odmah posle SOI)
  const padded = joinBytes(input.subarray(0, 2), Uint8Array.of(0xff, 0xff), input.subarray(2));
  const r = ok(padded);
  assert.deepEqual(r.bytes, input);
});

test('inspectJpeg: entropijski podaci sa FF00 i RST markerima ne prekidaju sken', () => {
  ok(buildJpeg({ scanData: Uint8Array.from([0xff, 0x00, 0xff, 0xd7, 0x01, 0xff, 0x00, 0xff, 0xd0]) }));
});

test('inspectJpeg: drugi formati su unsupported_type (PNG, PDF, .docx, tekst, prazno)', () => {
  rejected(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), 'unsupported_type');
  rejected(text('%PDF-1.7\n'), 'unsupported_type');
  rejected(buildDocx(), 'unsupported_type');
  rejected(text('obican tekst'), 'unsupported_type');
  rejected(new Uint8Array(0), 'unsupported_type');
  rejected(Uint8Array.of(0xff), 'unsupported_type');
  // HEIC/WebP (telefon ih uvek prekodira u JPEG, server ih ne prima)
  rejected(text('\0\0\0\x18ftypheic'), 'unsupported_type');
  rejected(text('RIFF\0\0\0\0WEBPVP8 '), 'unsupported_type');
});

test('inspectJpeg: FF na početku nije dovoljno, drugi bajt mora biti D8 (npr. MP3 počinje sa FF FB)', () => {
  rejected(Uint8Array.of(0xff, 0xfb, 0x90, 0x64, 0x00, 0x00), 'unsupported_type');
  rejected(joinBytes(Uint8Array.of(0xff, 0xe1), buildJpeg().subarray(2)), 'unsupported_type');
});

test('granice iz plana: 800KB po slici, 4MB ukupno, 5 slika, najduža stranica 200-2000px, telefon cilja 1568px i 700KB', () => {
  assert.equal(IMAGE_MAX_BYTES, 800 * 1024);
  assert.equal(IMAGES_MAX_TOTAL_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_IMAGES_PER_QUESTION, 5);
  assert.equal(MAX_DOCUMENT_PAGES, 5);
  assert.equal(IMAGE_MIN_LONG_EDGE, 200);
  assert.equal(IMAGE_MAX_LONG_EDGE, 2000);
  assert.equal(CLIENT_TARGET_LONG_EDGE, 1568);
  assert.equal(CLIENT_TARGET_BYTES, 700 * 1024);
  // Usaglašenost: telefon pravi ono što server prima, a 5 slika staje u telo zahteva na Vercelu (4,5MB)
  assert.ok(CLIENT_TARGET_LONG_EDGE <= IMAGE_MAX_LONG_EDGE && CLIENT_TARGET_LONG_EDGE >= IMAGE_MIN_LONG_EDGE);
  assert.ok(CLIENT_TARGET_BYTES < IMAGE_MAX_BYTES);
  assert.ok(IMAGE_MAX_BYTES * MAX_IMAGES_PER_QUESTION <= IMAGES_MAX_TOTAL_BYTES);
  assert.ok(IMAGES_MAX_TOTAL_BYTES < 4.5 * 1024 * 1024);
});

test('inspectJpeg: fajl veći od granice je image_too_large i pre parsiranja', () => {
  const big = buildJpeg({ scanData: new Uint8Array(IMAGE_MAX_BYTES).fill(0x11) });
  rejected(big, 'image_too_large');
  // Tačno na granici prolazi
  const base = buildJpeg({ scanData: new Uint8Array(0) }).byteLength;
  ok(buildJpeg({ scanData: new Uint8Array(IMAGE_MAX_BYTES - base).fill(0x11) }));
  // Smeće veće od granice sa JPEG potpisom: veličina se proverava pre strukture
  rejected(joinBytes(Uint8Array.of(0xff, 0xd8), new Uint8Array(IMAGE_MAX_BYTES)), 'image_too_large');
});

test('inspectJpeg: najduža stranica mora biti između granica', () => {
  ok(buildJpeg({ width: IMAGE_MAX_LONG_EDGE, height: 1500 }));
  ok(buildJpeg({ width: 1500, height: IMAGE_MAX_LONG_EDGE }));
  ok(buildJpeg({ width: IMAGE_MIN_LONG_EDGE, height: 150 }));
  ok(buildJpeg({ width: 10, height: IMAGE_MIN_LONG_EDGE }));
  rejected(buildJpeg({ width: IMAGE_MAX_LONG_EDGE + 1, height: 1500 }), 'image_dimensions');
  rejected(buildJpeg({ width: 1500, height: IMAGE_MAX_LONG_EDGE + 1 }), 'image_dimensions');
  rejected(buildJpeg({ width: IMAGE_MIN_LONG_EDGE - 1, height: 100 }), 'image_dimensions');
  rejected(buildJpeg({ width: 100, height: IMAGE_MIN_LONG_EDGE - 1 }), 'image_dimensions');
  rejected(buildJpeg({ width: 65535, height: 65535 }), 'image_dimensions');
});

test('inspectJpeg: dimenzija 0 (visina iz DNL markera) se odbija', () => {
  rejected(buildJpeg({ width: 1200, height: 0 }), 'image_dimensions');
  rejected(buildJpeg({ width: 0, height: 1200 }), 'image_dimensions');
});

test('inspectJpeg: skraćen fajl je unreadable_image', () => {
  const full = buildJpeg();
  rejected(full.subarray(0, full.byteLength - 2), 'unreadable_image', 'truncated'); // bez EOI
  rejected(full.subarray(0, 10), 'unreadable_image', 'truncated'); // usred segmenta
  rejected(Uint8Array.of(0xff, 0xd8), 'unreadable_image', 'truncated');
  rejected(Uint8Array.of(0xff, 0xd8, 0xff), 'unreadable_image', 'truncated');
  rejected(Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00), 'unreadable_image', 'truncated');
});

test('inspectJpeg: dužina segmenta koja izlazi van fajla je truncated, a manja od 2 je bad_segment', () => {
  // Lažna dužina i skraćen fajl izgledaju isto
  const lies = joinBytes(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff), text('Exif'));
  rejected(lies, 'unreadable_image', 'truncated');
  const tooShort = joinBytes(Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01), buildJpeg().subarray(2));
  rejected(tooShort, 'unreadable_image', 'bad_segment');
});

test('inspectJpeg: bajt koji nije marker na mestu segmenta je bad_segment', () => {
  const input = buildJpeg();
  rejected(joinBytes(input.subarray(0, 2), Uint8Array.of(0x00), input.subarray(2)), 'unreadable_image', 'bad_segment');
});

test('inspectJpeg: podaci posle EOI se odbijaju (trailing_data)', () => {
  rejected(buildJpeg({ trailing: text('PK\x03\x04skriven zip') }), 'unreadable_image', 'trailing_data');
  rejected(buildJpeg({ trailing: Uint8Array.of(0) }), 'unreadable_image', 'trailing_data');
});

test('inspectJpeg: bez SOF-a ili bez skena se odbija', () => {
  rejected(buildJpeg({ omitFrame: true }), 'unreadable_image', 'no_frame');
  rejected(buildJpeg({ omitScan: true }), 'unreadable_image', 'no_scan');
  rejected(buildJpeg({ omitFrame: true, omitScan: true }), 'unreadable_image', 'no_frame');
});

test('inspectJpeg: dva SOF-a se odbijaju', () => {
  const second = segment(0xc0, Uint8Array.from([8, 0, 100, 0, 100, 1, 1, 0x11, 0]));
  rejected(buildJpeg({ afterFrame: [{ raw: second }] }), 'unreadable_image', 'multiple_frames');
});

test('inspectJpeg: nepodržane vrste kodiranja se odbijaju (lossless, aritmetičko, hijerarhijsko)', () => {
  for (const marker of [0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
    rejected(buildJpeg({ sofMarker: marker }), 'unreadable_image', 'unsupported_frame');
  }
});

test('inspectJpeg: SOF kraći od 6 bajtova podataka je bad_segment (dimenzije se ne čitaju iz sledećeg segmenta)', () => {
  const shortFrame = segment(0xc0, Uint8Array.of(8, 0x03));
  rejected(buildJpeg({ omitFrame: true, before: [{ raw: shortFrame }] }), 'unreadable_image', 'bad_segment');
});

test('inspectJpeg: FF00 na mestu segmenta (van skena) se odbija', () => {
  const input = buildJpeg();
  rejected(joinBytes(input.subarray(0, 2), Uint8Array.of(0xff, 0x00), input.subarray(2)), 'unreadable_image', 'unknown_marker');
});

test('inspectJpeg: CMYK (4 komponente) i neobičan broj komponenti se odbijaju', () => {
  rejected(buildJpeg({ components: 4 }), 'unreadable_image', 'unsupported_components');
  rejected(buildJpeg({ components: 2 }), 'unreadable_image', 'unsupported_components');
});

test('inspectJpeg: nepoznat marker pre ili posle skena se odbija', () => {
  for (const marker of [0xf0, 0xf7, 0xfd, 0xc8, 0xcc, 0xde, 0xdf]) {
    rejected(buildJpeg({ afterFrame: [{ marker, data: 'x' }] }), 'unreadable_image', 'unknown_marker');
  }
  rejected(buildJpeg({ scans: 2, betweenScans: [{ marker: 0xf1, data: 'x' }] }), 'unreadable_image', 'unknown_marker');
});

test('inspectJpeg: SOI usred fajla (ugnežđen JPEG) se odbija', () => {
  rejected(buildJpeg({ afterFrame: [{ raw: Uint8Array.of(0xff, 0xd8) }] }), 'unreadable_image', 'unknown_marker');
});

test('inspectJpeg: DQT, DHT i DRI su dozvoljeni i ostaju u izlazu', () => {
  const dri = segment(0xdd, Uint8Array.of(0, 8));
  const input = buildJpeg({ afterFrame: [{ raw: dri }], scans: 2, betweenScans: [{ raw: DHT }, { raw: dri }], sofMarker: 0xc2 });
  assert.deepEqual(ok(input).bytes, input);
});

test('inspectJpeg: prazni entropijski podaci su dozvoljeni (struktura je ispravna)', () => {
  ok(buildJpeg({ scanData: new Uint8Array(0) }));
  assert.ok(DEFAULT_SCAN_DATA.byteLength > 0);
});
