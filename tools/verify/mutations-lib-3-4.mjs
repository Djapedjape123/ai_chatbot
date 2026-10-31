// Mutacije koraka 3.4 (lib/file-read.ts, lib/file-worker.ts, lib/docx-read.ts). Svaka mora da obori bar jedan test.
// Pokretanje iz korena repozitorijuma:
//   node tools/verify/mutations-lib-3-4.mjs [deo imena mutacije]

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (name) => path.join(root, 'lib', name);
const read = f('file-read.ts');
const worker = f('file-worker.ts');
const docx = f('docx-read.ts');

const mutations = [
  // --- docx-read.ts
  { name: 'docx-read: provera aktivnog sadržaja se preskače', file: docx, from: 'if (!inspection.ok) return inspection;', to: '' },
  { name: 'docx-read: greška mammotha se ne hvata', file: docx, from: '  } catch {\n    return { ok: false, reason: \'unreadable_docx\', finding: \'mammoth_failed\' };\n  }', to: '  } finally {\n  }' },
  { name: 'docx-read: vraća prazan tekst', file: docx, from: 'return { ok: true, text: value };', to: "return { ok: true, text: '' };" },
  { name: 'docx-read: greška mammotha je druga vrsta odbijanja', file: docx, from: "return { ok: false, reason: 'unreadable_docx', finding: 'mammoth_failed' };", to: "return { ok: false, reason: 'archive_bomb', finding: 'zip_entries' };" },

  // --- file-worker.ts
  { name: 'worker: PDF i Word zamenjeni', file: worker, from: "job.kind === 'pdf' ? await readPdf(job.bytes) : await readDocx(job.bytes)", to: "job.kind === 'pdf' ? await readDocx(job.bytes) : await readPdf(job.bytes)" },
  { name: 'worker: rezultat se ne šalje', file: worker, from: 'parentPort?.postMessage(result);', to: '' },

  // --- file-read.ts
  { name: 'read: granica vremena 30 s', file: read, from: 'export const FILE_READ_TIMEOUT_MS = 20_000;', to: 'export const FILE_READ_TIMEOUT_MS = 30_000;' },
  { name: 'read: granica memorije 1024MB', file: read, from: 'export const FILE_READ_MAX_MEMORY_MB = 512;', to: 'export const FILE_READ_MAX_MEMORY_MB = 1024;' },
  { name: 'read: tajmer duplo duži od zadatog', file: read, from: "setTimeout(() => finish({ ok: false, reason: 'parse_timeout' }), timeoutMs)", to: "setTimeout(() => finish({ ok: false, reason: 'parse_timeout' }), timeoutMs * 2)" },
  { name: 'read: istek vremena se javlja kao greška worker-a', file: read, from: "setTimeout(() => finish({ ok: false, reason: 'parse_timeout' }), timeoutMs)", to: "setTimeout(() => finish({ ok: false, reason: 'worker_failed' }), timeoutMs)" },
  { name: 'read: tajmer se ne gasi kad posao završi', file: read, from: '      clearTimeout(timer);\n', to: '' },
  { name: 'read: nit se ne prekida posle rezultata', file: read, from: 'void worker.terminate().finally(() => resolve(result));', to: 'resolve(result);' },
  { name: 'read: nestanak memorije se javlja kao greška worker-a', file: read, from: "if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {", to: "if (false) {" },
  { name: 'read: greška worker-a se javlja kao bomba', file: read, from: "      console.error('File worker: greška:', error);\n      finish({ ok: false, reason: 'worker_failed' });", to: "      console.error('File worker: greška:', error);\n      finish({ ok: false, reason: 'archive_bomb', finding: 'worker_out_of_memory' });" },
  { name: 'read: izlaz bez rezultata se ne prijavljuje', file: read, from: "worker.once('exit', () => finish({ ok: false, reason: 'worker_failed' }));", to: '' },
  { name: 'read: greške worker-a se ne hvataju', file: read, from: "worker.once('error', (error: Error & { code?: string }) => {", to: "worker.once('errorX', (error: Error & { code?: string }) => {" },
  { name: 'read: pad pri pokretanju se ne hvata', file: read, from: "    } catch (error) {\n      console.error('File worker: pokretanje nije uspelo:', error);\n      resolve({ ok: false, reason: 'worker_failed' });\n      return;\n    }", to: '    } finally {\n    }' },
  { name: 'read: rezultat worker-a se ne prosleđuje', file: read, from: "worker.once('message', (message: FileReadResult) => finish(message));", to: "worker.once('message', () => finish({ ok: false, reason: 'worker_failed' }));" },
  { name: 'read: posao se šalje bez bajtova (prazan workerData)', file: read, from: 'workerData: job,\n    resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },\n  });\n}', to: 'workerData: { kind: job.kind, bytes: new Uint8Array(0) },\n    resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },\n  });\n}' },
  { name: 'read: ograničenje memorije se ne prosleđuje worker-u', file: read, from: 'resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },\n  });\n}', to: '\n  });\n}', equivalent: 'bez ograničenja worker-a OOM test sa 64MB bi trošio memoriju bez granice; mutacija se ne izvršava jer bi mogla da ugrozi računar' },
];

const files = ['file-read', 'docx-read'].map((n) => `lib/${n}.test.ts`);

function runTests() {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--test', ...files], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { failed: true, detail: 'vremensko ograničenje (petlja?)' };
  const names = [...(r.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  return { failed: r.status !== 0, detail: names.slice(0, 2).join(' | ').slice(0, 110) };
}

const only = process.argv[2];
const selected = (only ? mutations.filter((m) => m.name.includes(only)) : mutations).filter((m) => !m.equivalent || only);

const { results, intact } = await runMutations(selected, runTests, { label: 'Mutacije lib/ (3.4)' });
const bad = results.filter((r) => r.status !== 'UHVAĆENA' && !r.equivalent);
process.exit(intact && bad.length === 0 ? 0 : 1);
