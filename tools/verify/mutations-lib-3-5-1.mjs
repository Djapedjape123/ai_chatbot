// Mutacije koraka 3.5.1 (lib/image-inspect.ts, lib/image-limits.ts). Svaka mora da obori bar jedan test.
// Pokretanje iz korena repozitorijuma:
//   node tools/verify/mutations-lib-3-5-1.mjs [deo imena mutacije]

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (name) => path.join(root, 'lib', name);
const insp = f('image-inspect.ts');
const limits = f('image-limits.ts');

const mutations = [
  // --- granice
  { name: 'limits: 1MB po slici', file: limits, from: 'export const IMAGE_MAX_BYTES = 800 * 1024;', to: 'export const IMAGE_MAX_BYTES = 1024 * 1024;' },
  { name: 'limits: 6 slika uz pitanje', file: limits, from: 'export const MAX_IMAGES_PER_QUESTION = 5;', to: 'export const MAX_IMAGES_PER_QUESTION = 6;' },
  { name: 'limits: 5MB ukupno', file: limits, from: 'export const IMAGES_MAX_TOTAL_BYTES = 4 * 1024 * 1024;', to: 'export const IMAGES_MAX_TOTAL_BYTES = 5 * 1024 * 1024;' },
  { name: 'limits: telefon cilja 2048px', file: limits, from: 'export const CLIENT_TARGET_LONG_EDGE = 1568;', to: 'export const CLIENT_TARGET_LONG_EDGE = 2048;' },
  { name: 'limits: najduža stranica 4000', file: limits, from: 'export const IMAGE_MAX_LONG_EDGE = 2000;', to: 'export const IMAGE_MAX_LONG_EDGE = 4000;' },

  // --- potpis i veličina
  { name: 'potpis: proverava se samo prvi bajt', file: insp, from: "if (len < 2 || bytes[0] !== 0xff || bytes[1] !== SOI)", to: "if (len < 2 || bytes[0] !== 0xff)" },
  { name: 'potpis: prazan niz se ne odbija', file: insp, from: "if (len < 2 || bytes[0] !== 0xff || bytes[1] !== SOI)", to: "if (len >= 2 && (bytes[0] !== 0xff || bytes[1] !== SOI))" },
  { name: 'veličina: ne proverava se', file: insp, from: "if (len > IMAGE_MAX_BYTES) return { ok: false, reason: 'image_too_large' };", to: '' },
  { name: 'veličina: >= umesto >', file: insp, from: 'if (len > IMAGE_MAX_BYTES)', to: 'if (len >= IMAGE_MAX_BYTES)' },

  // --- segmenti
  { name: 'segment: bajt koji nije FF se preskače', file: insp, from: "if (bytes[pos] !== 0xff) return unreadable('bad_segment');\n    while", to: "while (pos < len && bytes[pos] !== 0xff) pos++;\n    while" },
  { name: 'segment: popuna FF se ne preskače', file: insp, from: '    while (pos < len && bytes[pos] === 0xff) pos++;\n', to: '    pos++;\n' },
  { name: 'segment: FF00 van skena je dozvoljen', file: insp, from: '    if (!lengthKnown) return', to: '    if (marker === 0x00) {} else if (!lengthKnown) return' },
  { name: 'segment: nepoznat marker se prihvata', file: insp, from: "if (!lengthKnown) return unreadable('unknown_marker');", to: '' },
  { name: 'segment: SOI usred fajla se prihvata kao segment', file: insp, from: 'const lengthKnown = marker === SOS ||', to: 'const lengthKnown = marker === SOI || marker === SOS ||' },
  { name: 'segment: dužina manja od 2 se prihvata', file: insp, from: "if (length < 2) return unreadable('bad_segment');", to: '', equivalent: 'dužina 0 ili 1 ostavlja pos na bajtu dužine (0x00 ili 0x01), koji nije FF, pa sledeći krug vraća bad_segment; provera ostaje radi jasnoće' },
  { name: 'segment: dužina van fajla se ne proverava', file: insp, from: "if (end > len) return unreadable('truncated');", to: '', equivalent: 'pos = end > len, pa sledeći krug (ili petlja skena) vraća truncated; provera ostaje da se ne čita van niza (SOF)' },
  { name: 'segment: skraćena dužina se ne proverava', file: insp, from: "if (pos + 2 > len) return unreadable('truncated');", to: '' },

  // --- metapodaci
  { name: 'metapodaci: APP segmenti ostaju', file: insp, from: 'if (isApp(marker) || marker === COM) {\n      // Metapodaci: preskaču se\n      pos = end;\n      continue;\n    }', to: '' },
  { name: 'metapodaci: APP0 (JFIF) se ne uklanja', file: insp, from: 'const isApp = (marker: number) => marker >= 0xe0 && marker <= 0xef;', to: 'const isApp = (marker: number) => marker >= 0xe1 && marker <= 0xef;' },
  { name: 'metapodaci: APP15 se ne prepoznaje', file: insp, from: 'const isApp = (marker: number) => marker >= 0xe0 && marker <= 0xef;', to: 'const isApp = (marker: number) => marker >= 0xe0 && marker < 0xef;' },
  { name: 'metapodaci: komentar ostaje', file: insp, from: 'if (isApp(marker) || marker === COM) {', to: 'if (isApp(marker)) {' },

  // --- okvir
  { name: 'okvir: drugi SOF se prihvata', file: insp, from: "if (frame || scans > 0) return unreadable('multiple_frames');", to: '' },
  { name: 'okvir: nepodržano kodiranje se prihvata', file: insp, from: "if (UNSUPPORTED_FRAMES.has(marker)) return unreadable('unsupported_frame');", to: "if (UNSUPPORTED_FRAMES.has(marker)) {}" },
  { name: 'okvir: SOF3 je podržan', file: insp, from: 'new Set([0xc0, 0xc1, 0xc2])', to: 'new Set([0xc0, 0xc1, 0xc2, 0xc3])', equivalent: 'SOF3 je i u UNSUPPORTED_FRAMES, koji se proverava pre SUPPORTED_FRAMES' },
  { name: 'okvir: SOF1 nije podržan', file: insp, from: 'new Set([0xc0, 0xc1, 0xc2])', to: 'new Set([0xc0, 0xc2])' },
  { name: 'okvir: CMYK se prihvata', file: insp, from: 'if (components !== 1 && components !== 3)', to: 'if (components < 1 || components > 4)' },
  { name: 'okvir: širina i visina zamenjene', file: insp, from: 'const height = (bytes[pos + 3] << 8) | bytes[pos + 4];\n      const width = (bytes[pos + 5] << 8) | bytes[pos + 6];', to: 'const width = (bytes[pos + 3] << 8) | bytes[pos + 4];\n      const height = (bytes[pos + 5] << 8) | bytes[pos + 6];' },
  { name: 'okvir: kratak SOF se prihvata', file: insp, from: "if (length < 8) return unreadable('bad_segment');", to: '' },

  // --- sken
  { name: 'sken: SOS bez okvira se prihvata', file: insp, from: "if (!frame) return unreadable('no_frame');\n      scans++;", to: 'scans++;' },
  { name: 'sken: RST prekida sken', file: insp, from: 'if (next === 0x00 || isRestart(next)) {', to: 'if (next === 0x00) {' },
  { name: 'sken: FF00 prekida sken', file: insp, from: 'if (next === 0x00 || isRestart(next)) {', to: 'if (isRestart(next)) {' },
  { name: 'sken: kraj fajla usred skena se prihvata kao kraj slike', file: insp, from: '      kept.push(bytes.subarray(markerStart, pos));\n      continue;', to: '      kept.push(bytes.subarray(markerStart, pos));\n      if (pos >= len) { kept.push(Uint8Array.of(0xff, 0xd9)); break; }\n      continue;' },
  { name: 'sken: FF na poslednjem bajtu se preskače', file: insp, from: '        if (next === 0xff) {', to: '        if (next === 0xff || next === undefined) {' , equivalent: 'oba puta spoljna petlja dobija kraj fajla (pos = len ili FF na kraju) i vraća truncated' },
  { name: 'sken: entropijski podaci se ne kopiraju', file: insp, from: 'kept.push(bytes.subarray(markerStart, pos));\n      continue;', to: 'kept.push(bytes.subarray(markerStart, end));\n      continue;' },

  // --- kraj
  { name: 'kraj: smeće posle EOI se prihvata', file: insp, from: "if (pos !== len) return unreadable('trailing_data');", to: '' },
  { name: 'kraj: bez skena se prihvata', file: insp, from: "if (scans === 0) return unreadable(frame ? 'no_scan' : 'no_frame');", to: '' },
  { name: 'kraj: bez okvira se javlja kao bez skena', file: insp, from: "unreadable(frame ? 'no_scan' : 'no_frame')", to: "unreadable('no_scan')" },
  { name: 'kraj: EOI se ne kopira', file: insp, from: "      kept.push(bytes.subarray(markerStart, pos));\n      break;", to: '      break;' },
  { name: 'kraj: fajl bez EOI se prihvata', file: insp, from: "    if (pos >= len) return unreadable('truncated');\n    if (bytes[pos] !== 0xff) return unreadable('bad_segment');", to: "    if (pos >= len) break;\n    if (bytes[pos] !== 0xff) return unreadable('bad_segment');" },

  // --- dimenzije
  { name: 'dimenzije: nula se prihvata', file: insp, from: 'Math.min(width, height) === 0 || ', to: '' },
  { name: 'dimenzije: donja granica se ne proverava', file: insp, from: 'longEdge < IMAGE_MIN_LONG_EDGE || ', to: '' },
  { name: 'dimenzije: gornja granica se ne proverava', file: insp, from: ' || longEdge > IMAGE_MAX_LONG_EDGE', to: '' },
  { name: 'dimenzije: kraća umesto duže stranice', file: insp, from: 'const longEdge = Math.max(width, height);', to: 'const longEdge = Math.min(width, height);' },
  { name: 'dimenzije: >= umesto > na gornjoj granici', file: insp, from: 'longEdge > IMAGE_MAX_LONG_EDGE', to: 'longEdge >= IMAGE_MAX_LONG_EDGE' },
  { name: 'izlaz: vraća originalne bajtove (sa EXIF-om)', file: insp, from: 'bytes: concat(kept) };', to: 'bytes };' },
];

const files = ['lib/image-inspect.test.ts'];

function runTests() {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--test', ...files], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 60_000,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { failed: true, detail: 'vremensko ograničenje (petlja?)' };
  const names = [...(r.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  return { failed: r.status !== 0, detail: names.slice(0, 2).join(' | ').slice(0, 110) };
}

const only = process.argv[2];
const selected = (only ? mutations.filter((m) => m.name.includes(only)) : mutations).filter((m) => !m.equivalent || only);
const { results, intact } = await runMutations(selected, runTests, { label: 'Mutacije lib/ (3.5.1)' });
const bad = results.filter((r) => r.status !== 'UHVAĆENA' && !r.equivalent);
process.exit(intact && bad.length === 0 ? 0 : 1);
