import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { FILE_READ_MAX_MEMORY_MB, FILE_READ_TIMEOUT_MS, readFileInWorker, type FileJob } from './file-read.ts';
import { buildDocx } from './test-support/zip-builder.ts';
import { SAMPLE_TEXT, basePdf, basePdfObjects, buildPdf } from './test-support/pdf-builder.ts';

const misbehaving = (job: FileJob, maxMemoryMb: number) =>
  new Worker(new URL('./test-support/hang-worker.ts', import.meta.url), {
    workerData: job,
    resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },
  });

// hang-worker.ts bira ponašanje iz workerData.mode; job nosi `mode` kao dodatno polje samo u testu
const bad = (mode: string) => ({ kind: 'pdf' as const, bytes: new Uint8Array(1), mode });

test('readFileInWorker: granice su 20 sekundi i 512MB', () => {
  assert.equal(FILE_READ_TIMEOUT_MS, 20_000);
  assert.equal(FILE_READ_MAX_MEMORY_MB, 512);
});

test('readFileInWorker: PDF se čita u worker-u i vraća isti rezultat kao direktno čitanje', async () => {
  const r = await readFileInWorker({ kind: 'pdf', bytes: basePdf() });
  assert.ok(r.ok && 'text' in r && r.text.includes(SAMPLE_TEXT));
});

test('readFileInWorker: .docx se čita u worker-u', async () => {
  const r = await readFileInWorker({ kind: 'docx', bytes: buildDocx() });
  assert.ok(r.ok && 'text' in r && r.text.includes('Član 1.'));
});

test('readFileInWorker: odbijanja (aktivan sadržaj) stižu iz worker-a nepromenjena', async () => {
  const js = buildPdf(basePdfObjects({ catalogExtra: '/OpenAction << /S /JavaScript /JS (x) >>' }));
  assert.deepEqual(await readFileInWorker({ kind: 'pdf', bytes: js }), { ok: false, reason: 'active_content', finding: 'pdf_javascript' });
  const macro = buildDocx([{ name: 'word/vbaProject.bin', data: 'MZ' }]);
  assert.deepEqual(await readFileInWorker({ kind: 'docx', bytes: macro }), { ok: false, reason: 'active_content', finding: 'docx_macro' });
});

test('readFileInWorker: ne oduzima pozivaocu bajtove', async () => {
  const bytes = basePdf();
  const before = bytes.length;
  await readFileInWorker({ kind: 'pdf', bytes });
  assert.equal(bytes.length, before);
});

test('readFileInWorker: zaglavljen worker se prekida posle isteka vremena (parse_timeout) i nit stvarno staje', async () => {
  const started = Date.now();
  const r = await readFileInWorker(bad('hang'), { timeoutMs: 300, createWorker: misbehaving });
  const elapsed = Date.now() - started;
  assert.deepEqual(r, { ok: false, reason: 'parse_timeout' });
  assert.ok(elapsed >= 300, `prerano: ${elapsed} ms`);
  // Da terminate() nije prekinuo petlju, await bi večno visio i test bi pao na vremenskom ograničenju
  assert.ok(elapsed < 550, `prekasno: ${elapsed} ms (tajmer je 300 ms)`);
});

test('readFileInWorker: vreme se računa od početka čitanja, a brz worker se ne čeka do isteka', async () => {
  const started = Date.now();
  const r = await readFileInWorker(bad('echo'), { timeoutMs: 10_000, createWorker: misbehaving });
  assert.deepEqual(r, { ok: true, text: 'echo' });
  assert.ok(Date.now() - started < 5000);
});

test('readFileInWorker: worker koji padne je worker_failed', async () => {
  assert.deepEqual(await readFileInWorker(bad('throw'), { createWorker: misbehaving }), { ok: false, reason: 'worker_failed' });
});

test('readFileInWorker: worker koji izađe bez rezultata je worker_failed', async () => {
  assert.deepEqual(await readFileInWorker(bad('exit'), { createWorker: misbehaving }), { ok: false, reason: 'worker_failed' });
});

test('readFileInWorker: worker koji potroši svu dozvoljenu memoriju je archive_bomb (worker_out_of_memory)', async () => {
  const r = await readFileInWorker(bad('oom'), { createWorker: misbehaving, maxMemoryMb: 64 });
  assert.deepEqual(r, { ok: false, reason: 'archive_bomb', finding: 'worker_out_of_memory' });
});

test('readFileInWorker: dva zadatka istovremeno ne smetaju jedan drugom', async () => {
  const [a, b] = await Promise.all([
    readFileInWorker({ kind: 'pdf', bytes: basePdf({ text: 'prvi dokument' }) }),
    readFileInWorker({ kind: 'docx', bytes: buildDocx() }),
  ]);
  assert.ok(a.ok && 'text' in a && a.text.includes('prvi dokument'));
  assert.ok(b.ok && 'text' in b && b.text.includes('Član 1.'));
});

test('readFileInWorker: zaglavljen worker ne sprečava sledeći da prođe', async () => {
  const hung = await readFileInWorker(bad('hang'), { timeoutMs: 200, createWorker: misbehaving });
  assert.equal(hung.ok, false);
  const next = await readFileInWorker({ kind: 'pdf', bytes: basePdf() });
  assert.ok(next.ok);
});

test('readFileInWorker: brz posao ne ostavlja otvoren tajmer (inače bi proces visio do isteka 20 s)', async () => {
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const before = timers();
  const r = await readFileInWorker({ kind: 'pdf', bytes: basePdf() });
  assert.ok(r.ok);
  assert.equal(timers(), before);
});

test('readFileInWorker: worker koji ne može ni da se pokrene (izuzetak pri kreiranju) je worker_failed', async () => {
  const r = await readFileInWorker({ kind: 'pdf', bytes: basePdf() }, {
    createWorker: () => {
      throw new Error('ne može da se pokrene');
    },
  });
  assert.deepEqual(r, { ok: false, reason: 'worker_failed' });
});
