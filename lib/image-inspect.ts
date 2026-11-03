// Provera slike sa telefona pre slanja Claude-u (Faza 3.5). Server prima SAMO JPEG: pregledač svaku sliku
// prekodira kroz canvas (lib/image-prepare.ts), pa drugi formati ovde ne treba da stignu.
// Čita samo strukturu JPEG-a (markere i segmente), ne dekodira piksele. Bez server-only importa i bez Node API-ja,
// da bi se moglo testirati (npm test).
//
// Čitač je NAMERNO strog, kao lib/zip-directory.ts: tačno jedan okvir (baseline, extended ili progressive),
// 1 ili 3 komponente, samo poznati segmenti, EOI tačno na kraju fajla. Sve ostalo je odbijeno.
// Izlaz je ista slika BEZ svih APP0-APP15 i COM segmenata (EXIF sa GPS-om, XMP, ICC, Photoshop, komentari),
// gde god da se nalaze, i bez bajtova za popunu između segmenata. Dekoderu oni nisu potrebni.
import { IMAGE_MAX_BYTES, IMAGE_MAX_LONG_EDGE, IMAGE_MIN_LONG_EDGE } from './image-limits.ts';

export type JpegFinding =
  | 'truncated'
  | 'bad_segment'
  | 'no_frame'
  | 'multiple_frames'
  | 'unsupported_frame'
  | 'unsupported_components'
  | 'unknown_marker'
  | 'no_scan'
  | 'trailing_data';

export type JpegRejection =
  | { ok: false; reason: 'unsupported_type' | 'image_too_large' }
  | { ok: false; reason: 'image_dimensions'; width: number; height: number }
  | { ok: false; reason: 'unreadable_image'; finding: JpegFinding };

export type JpegInspection = { ok: true; width: number; height: number; bytes: Uint8Array } | JpegRejection;

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DHT = 0xc4;
const DRI = 0xdd;
const COM = 0xfe;
// Baseline, extended sequential i progressive Huffman: jedino što pregledači prave i svi dekoderi čitaju
const SUPPORTED_FRAMES = new Set([0xc0, 0xc1, 0xc2]);
const UNSUPPORTED_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const isApp = (marker: number) => marker >= 0xe0 && marker <= 0xef;
const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

const unreadable = (finding: JpegFinding): JpegRejection => ({ ok: false, reason: 'unreadable_image', finding });

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

export function inspectJpeg(bytes: Uint8Array): JpegInspection {
  const len = bytes.byteLength;
  if (len < 2 || bytes[0] !== 0xff || bytes[1] !== SOI) return { ok: false, reason: 'unsupported_type' };
  // Veličina pre strukture: veliki fajl se ne parsira
  if (len > IMAGE_MAX_BYTES) return { ok: false, reason: 'image_too_large' };

  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let frame: { width: number; height: number } | null = null;
  let scans = 0;
  let pos = 2;

  for (;;) {
    if (pos >= len) return unreadable('truncated');
    if (bytes[pos] !== 0xff) return unreadable('bad_segment');
    while (pos < len && bytes[pos] === 0xff) pos++;
    if (pos >= len) return unreadable('truncated');
    const marker = bytes[pos];
    const markerStart = pos - 1;
    pos++;

    if (marker === EOI) {
      // Sken postoji samo posle okvira (vidi SOS), pa scans > 0 znači i da okvir postoji
      if (scans === 0) return unreadable(frame ? 'no_scan' : 'no_frame');
      if (pos !== len) return unreadable('trailing_data');
      kept.push(bytes.subarray(markerStart, pos));
      break;
    }
    // Svi ostali dozvoljeni markeri imaju dužinu; markeri bez dužine (SOI, TEM, RST van skena) nisu dozvoljeni
    const lengthKnown = marker === SOS || marker === DQT || marker === DHT || marker === DRI || marker === COM || isApp(marker) ||
      SUPPORTED_FRAMES.has(marker) || UNSUPPORTED_FRAMES.has(marker);
    if (!lengthKnown) return unreadable('unknown_marker');
    if (UNSUPPORTED_FRAMES.has(marker)) return unreadable('unsupported_frame');

    if (pos + 2 > len) return unreadable('truncated');
    const length = (bytes[pos] << 8) | bytes[pos + 1];
    if (length < 2) return unreadable('bad_segment');
    const end = pos + length;
    if (end > len) return unreadable('truncated');

    if (isApp(marker) || marker === COM) {
      // Metapodaci: preskaču se
      pos = end;
      continue;
    }

    if (SUPPORTED_FRAMES.has(marker)) {
      if (frame || scans > 0) return unreadable('multiple_frames');
      if (length < 8) return unreadable('bad_segment');
      const height = (bytes[pos + 3] << 8) | bytes[pos + 4];
      const width = (bytes[pos + 5] << 8) | bytes[pos + 6];
      const components = bytes[pos + 7];
      if (components !== 1 && components !== 3) return unreadable('unsupported_components');
      frame = { width, height };
    } else if (marker === SOS) {
      if (!frame) return unreadable('no_frame');
      scans++;
      // Entropijski podaci: traju do prvog markera koji nije FF00 (bajt sa vrednošću FF) ni RST.
      // Kraj fajla usred skena hvata spoljna petlja (truncated).
      pos = end;
      while (pos < len) {
        if (bytes[pos] !== 0xff) {
          pos++;
          continue;
        }
        const next = bytes[pos + 1];
        if (next === 0x00 || isRestart(next)) {
          pos += 2;
          continue;
        }
        if (next === 0xff) {
          pos++;
          continue;
        }
        break;
      }
      kept.push(bytes.subarray(markerStart, pos));
      continue;
    }

    kept.push(bytes.subarray(markerStart, end));
    pos = end;
  }

  const { width, height } = frame!;
  const longEdge = Math.max(width, height);
  if (Math.min(width, height) === 0 || longEdge < IMAGE_MIN_LONG_EDGE || longEdge > IMAGE_MAX_LONG_EDGE) {
    return { ok: false, reason: 'image_dimensions', width, height };
  }
  return { ok: true, width, height, bytes: concat(kept) };
}
