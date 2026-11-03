import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JPEG_QUALITY_STEPS, encodeWithinLimit, targetSize } from './image-prepare.ts';
import { isTouchCameraDevice } from './device.ts';
import { CLIENT_TARGET_BYTES, CLIENT_TARGET_LONG_EDGE } from './image-limits.ts';

test('targetSize: slika manja od granice ostaje iste veličine', () => {
  assert.deepEqual(targetSize(1200, 900, CLIENT_TARGET_LONG_EDGE), { width: 1200, height: 900 });
  assert.deepEqual(targetSize(CLIENT_TARGET_LONG_EDGE, 1000, CLIENT_TARGET_LONG_EDGE), { width: CLIENT_TARGET_LONG_EDGE, height: 1000 });
});

test('targetSize: telefonska slika (4032x3024) se smanjuje na najdužu stranicu 1568, odnos ostaje', () => {
  assert.deepEqual(targetSize(4032, 3024, 1568), { width: 1568, height: 1176 });
  // Uspravno
  assert.deepEqual(targetSize(3024, 4032, 1568), { width: 1176, height: 1568 });
});

test('targetSize: vrlo uska slika ne pada na 0 piksela', () => {
  assert.deepEqual(targetSize(10000, 2, 1568), { width: 1568, height: 1 });
});

test('encodeWithinLimit: vraća prvi kvalitet koji staje u granicu, od najboljeg ka slabijem', async () => {
  const tried: number[] = [];
  const sizes: Record<number, number> = { 0.85: 900_000, 0.75: 650_000, 0.65: 500_000 };
  const result = await encodeWithinLimit(async (q) => {
    tried.push(q);
    return new Blob([new Uint8Array(sizes[q] ?? 100)]);
  }, CLIENT_TARGET_BYTES);
  assert.equal(result?.size, 650_000);
  assert.deepEqual(tried, [0.85, 0.75]);
});

test('encodeWithinLimit: ako ni najslabiji kvalitet ne staje, vraća null', async () => {
  const tried: number[] = [];
  const result = await encodeWithinLimit(async (q) => {
    tried.push(q);
    return new Blob([new Uint8Array(CLIENT_TARGET_BYTES + 1)]);
  }, CLIENT_TARGET_BYTES);
  assert.equal(result, null);
  assert.deepEqual(tried, [...JPEG_QUALITY_STEPS]);
});

test('encodeWithinLimit: granica je uključiva, a neuspelo kodiranje (null) prelazi na sledeći kvalitet', async () => {
  const exact = await encodeWithinLimit(async () => new Blob([new Uint8Array(CLIENT_TARGET_BYTES)]), CLIENT_TARGET_BYTES);
  assert.equal(exact?.size, CLIENT_TARGET_BYTES);
  const tried: number[] = [];
  const afterNull = await encodeWithinLimit(async (q) => {
    tried.push(q);
    return tried.length === 1 ? null : new Blob([new Uint8Array(10)]);
  }, CLIENT_TARGET_BYTES);
  assert.equal(afterNull?.size, 10);
  assert.equal(tried.length, 2);
});

test('JPEG_QUALITY_STEPS: opada i ostaje u razumnim granicama za čitljiv tekst', () => {
  for (let i = 1; i < JPEG_QUALITY_STEPS.length; i++) assert.ok(JPEG_QUALITY_STEPS[i] < JPEG_QUALITY_STEPS[i - 1]);
  assert.ok(JPEG_QUALITY_STEPS[0] <= 0.9);
  assert.ok(JPEG_QUALITY_STEPS[JPEG_QUALITY_STEPS.length - 1] >= 0.4);
});

test('isTouchCameraDevice: telefon i tablet (ekran na dodir, grub pokazivač) da; računar ne', () => {
  assert.equal(isTouchCameraDevice({ coarsePointer: true, maxTouchPoints: 5 }), true);
  // iPad u "desktop" režimu Safarija i dalje ima dodir
  assert.equal(isTouchCameraDevice({ coarsePointer: true, maxTouchPoints: 1 }), true);
  assert.equal(isTouchCameraDevice({ coarsePointer: false, maxTouchPoints: 0 }), false);
  // Miš bez dodira, ili dodir bez grubog pokazivača (emulacija) nije dovoljan
  assert.equal(isTouchCameraDevice({ coarsePointer: true, maxTouchPoints: 0 }), false);
  assert.equal(isTouchCameraDevice({ coarsePointer: false, maxTouchPoints: 10 }), false);
});
