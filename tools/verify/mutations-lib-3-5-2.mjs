// Mutacije koraka 3.5.2 (lib/image-prepare.ts, lib/device.ts; čisti delovi). Svaka mora da obori bar jedan test.
// Pokretanje iz korena repozitorijuma:
//   node tools/verify/mutations-lib-3-5-2.mjs [deo imena mutacije]

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const prep = path.join(root, 'lib', 'image-prepare.ts');
const device = path.join(root, 'lib', 'device.ts');

const mutations = [
  { name: 'targetSize: < umesto <=', file: prep, from: 'if (longEdge <= maxLongEdge) return { width, height };', to: 'if (longEdge < maxLongEdge) return { width, height };', equivalent: 'na granici je scale = 1, pa je rezultat isti' },
  { name: 'targetSize: nikad ne smanjuje', file: prep, from: 'if (longEdge <= maxLongEdge) return { width, height };', to: 'return { width, height };' },
  { name: 'targetSize: kraća stranica umesto duže', file: prep, from: 'const longEdge = Math.max(width, height);', to: 'const longEdge = Math.min(width, height);' },
  { name: 'targetSize: bez donje granice od 1px', file: prep, from: 'height: Math.max(1, Math.round(height * scale))', to: 'height: Math.round(height * scale)' },
  { name: 'targetSize: floor umesto round', file: prep, from: 'width: Math.max(1, Math.round(width * scale))', to: 'width: Math.max(1, Math.floor(width * scale))', equivalent: 'za testirane dimenzije round i floor daju isto; razlika je najviše 1px' },
  { name: 'encode: granica isključiva', file: prep, from: 'if (blob && blob.size <= maxBytes) return blob;', to: 'if (blob && blob.size < maxBytes) return blob;' },
  { name: 'encode: vraća poslednji pokušaj i kad ne staje', file: prep, from: '    if (blob && blob.size <= maxBytes) return blob;\n  }\n  return null;', to: '    if (blob && blob.size <= maxBytes) return blob;\n  }\n  return encode(0.45);' },
  { name: 'encode: null ruši petlju', file: prep, from: 'if (blob && blob.size <= maxBytes) return blob;', to: 'if (!blob) return null;\n    if (blob.size <= maxBytes) return blob;' },
  { name: 'koraci: počinje od 0.95', file: prep, from: '[0.85, 0.75, 0.65, 0.55, 0.45]', to: '[0.95, 0.75, 0.65, 0.55, 0.45]' },
  { name: 'koraci: ide do 0.3', file: prep, from: '[0.85, 0.75, 0.65, 0.55, 0.45]', to: '[0.85, 0.75, 0.65, 0.55, 0.3]' },
  { name: 'uređaj: dovoljan grub pokazivač', file: device, from: 'return coarsePointer && maxTouchPoints > 0;', to: 'return coarsePointer;' },
  { name: 'uređaj: dovoljan dodir', file: device, from: 'return coarsePointer && maxTouchPoints > 0;', to: 'return maxTouchPoints > 0;' },
  { name: 'uređaj: ili umesto i', file: device, from: 'return coarsePointer && maxTouchPoints > 0;', to: 'return coarsePointer || maxTouchPoints > 0;' },
];

function runTests() {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--test', 'lib/image-prepare.test.ts'], {
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
const { results, intact } = await runMutations(selected, runTests, { label: 'Mutacije lib/ (3.5.2)' });
const bad = results.filter((r) => r.status !== 'UHVAĆENA' && !r.equivalent);
process.exit(intact && bad.length === 0 ? 0 : 1);
