// Proba Faze 3.5 u pravom pregledaču (Edge, headless): STVARNA funkcija prepareImage iz lib/image-prepare.ts
// (TypeScript se samo očisti od tipova i servira stranici) smanjuje i prekodira sliku, a rezultat se proverava
// serverskim čitačem lib/image-inspect.ts.
//
// Šta dokazuje: da JPEG koji pravi pravi pregledač kroz canvas prolazi naš strogi čitač (inače bi server odbio
// svaku sliku sa telefona), da se EXIF/GPS gubi već u pregledaču, da je najduža stranica 1568 i veličina do 700KB,
// i da se slika koja ne može da se otvori i premala slika odbijaju porukom na srpskom.
// Šta ne dokazuje: Safari na iPhone-u i Chrome na Androidu (drugi JPEG koderi; to je ručna provera 3.5.8), HEIC.
//
// Pokretanje iz korena repozitorijuma (ne traži build):
//   node --experimental-strip-types --disable-warning=ExperimentalWarning tools/verify/probe-browser-jpeg.mjs

import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright-core';
import { REPO_ROOT } from './lib/app.mjs';
import { inspectJpeg } from '../../lib/image-inspect.ts';
import { EXIF_GPS_APP1, segment } from '../../lib/test-support/jpeg-builder.ts';
import { joinBytes } from '../../lib/test-support/zip-builder.ts';

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `\n         ${String(detail).slice(0, 500)}` : ''}`);
  }
}

const ORIGIN = 'http://probe.local';
const serveTs = (file) => stripTypeScriptTypes(fs.readFileSync(path.join(REPO_ROOT, 'lib', file), 'utf8'), { mode: 'strip' });
const latin1 = (bytes) => Buffer.from(bytes).toString('latin1');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>proba</title>' });
    const file = url.pathname.replace('/lib/', '');
    if (['image-prepare.ts', 'image-limits.ts'].includes(file)) return route.fulfill({ contentType: 'text/javascript', body: serveTs(file) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGIN}/`);

  // Fotografija sa telefona: 4032x3024, "papir" sa tekstom i šumom (šum diže veličinu JPEG-a kao prava fotografija)
  const photo = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4032;
    c.height = 3024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 60;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = '#111';
    ctx.font = '64px serif';
    for (let y = 200; y < 2900; y += 90) ctx.fillText('Član 1. Ugovorne strane su saglasne da zakupodavac ...', 200, y);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const original = Uint8Array.from(photo);
  // Ubacujemo EXIF sa GPS-om odmah posle SOI, kao što to radi kamera telefona
  const withGps = joinBytes(original.subarray(0, 2), segment(EXIF_GPS_APP1.marker, EXIF_GPS_APP1.data), original.subarray(2));
  check('ulazna "fotografija" je velika (kao sa telefona) i ima GPS', withGps.byteLength > 1_000_000 && latin1(withGps).includes('GPSLatitude'), String(withGps.byteLength));

  const run = (bytes, type = 'image/jpeg') =>
    page.evaluate(
      async ({ data, type }) => {
        const { prepareImage } = await import('/lib/image-prepare.ts');
        try {
          const r = await prepareImage(new File([new Uint8Array(data)], 'slika', { type }));
          return { ok: true, width: r.width, height: r.height, type: r.blob.type, bytes: Array.from(new Uint8Array(await r.blob.arrayBuffer())), preview: r.previewUrl.startsWith('blob:') };
        } catch (e) {
          return { ok: false, name: e.name, message: e.message };
        }
      },
      { data: Array.from(bytes), type }
    );

  const r = await run(withGps);
  check('prepareImage uspeva u pravom pregledaču', r.ok, r.message);
  if (r.ok) {
    const out = Uint8Array.from(r.bytes);
    const inspected = inspectJpeg(out);
    check('rezultat je image/jpeg sa lokalnim prikazom (blob:)', r.type === 'image/jpeg' && r.preview);
    check('najduža stranica 1568, odnos stranica očuvan (1568x1176)', r.width === 1568 && r.height === 1176, `${r.width}x${r.height}`);
    check('veličina do 700KB', out.byteLength <= 700 * 1024, String(out.byteLength));
    check('pregledač je već izbacio GPS i EXIF', !latin1(out).includes('GPSLatitude') && !latin1(out).includes('Exif'));
    check('serverski čitač prihvata JPEG iz pregledača', inspected.ok, JSON.stringify(inspected).slice(0, 200));
    check('server čita iste dimenzije', inspected.ok && inspected.width === 1568 && inspected.height === 1176);
  }

  const small = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 120;
    c.getContext('2d').fillRect(0, 0, 10, 10);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const rs = await run(Uint8Array.from(small), 'image/png');
  check('premala slika (150x120): odbijena porukom na srpskom', !rs.ok && rs.name === 'ImagePrepareError' && /premala/.test(rs.message), JSON.stringify(rs));

  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1000;
    c.height = 800;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.font = '40px sans-serif';
    ctx.fillText('Snimak ekrana', 50, 100);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const rp = await run(Uint8Array.from(png), 'image/png');
  check('PNG (snimak ekrana, providna pozadina) postaje JPEG koji server prihvata', rp.ok && rp.type === 'image/jpeg' && inspectJpeg(Uint8Array.from(rp.bytes)).ok, JSON.stringify(rp).slice(0, 200));
  if (rp.ok) {
    // Prvi piksel mora biti beo (providno je popunjeno belom, ne crnom)
    const firstPixel = await page.evaluate(async (data) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    }, rp.bytes);
    check('providna pozadina je bela, ne crna', firstPixel[0] > 240 && firstPixel[1] > 240 && firstPixel[2] > 240, JSON.stringify(firstPixel));
  }

  const rb = await run(new TextEncoder().encode('ovo nije slika'), 'image/heic');
  check('fajl koji nije slika: odbijen porukom „Slikajte dokument ponovo”', !rb.ok && rb.name === 'ImagePrepareError' && /Slikajte dokument ponovo/.test(rb.message), JSON.stringify(rb));
} finally {
  await browser.close();
}

console.log(`\n${passed} provera prošlo, ${failed} palo`);
process.exit(failed === 0 ? 0 : 1);
