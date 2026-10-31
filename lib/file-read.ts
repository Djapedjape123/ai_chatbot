// Čitanje PDF/Word fajla u worker niti sa ograničenjem vremena i memorije (Faza 3, korak 3.4).
//
// Zašto worker: pdf.js i mammoth rade u istom procesu kao ruta, a zlonameran ili oštećen fajl može da ih
// zaglavi. `Promise.race` sa tajmerom bi korisniku odmah vratio odgovor, ali bi parser nastavio da troši CPU
// do kraja funkcije; `worker.terminate()` prekida nit, pa CPU stvarno staje. Bez server-only importa, da bi se
// moglo testirati (npm test).
import { Worker } from 'node:worker_threads';
import type { DocxReadResult } from './docx-read.ts';
import type { PdfReadResult } from './pdf-read.ts';

export const FILE_READ_TIMEOUT_MS = 20_000;
// Ograničava samo V8 hrpu worker-a (ne i Buffer-e, koje ograničavaju lib/docx-inspect.ts i lib/pdf-inspect.ts)
export const FILE_READ_MAX_MEMORY_MB = 512;

export type FileJob = { kind: 'pdf' | 'docx'; bytes: Uint8Array };

export type FileReadResult =
  | PdfReadResult
  | DocxReadResult
  | { ok: false; reason: 'parse_timeout' }
  // Worker je pao ili izašao bez rezultata: greška servera, ne korisnika
  | { ok: false; reason: 'worker_failed' }
  // Potrošio je svu dozvoljenu memoriju: tretira se kao bomba (fajl je kriv)
  | { ok: false; reason: 'archive_bomb'; finding: 'worker_out_of_memory' };

export type FileReadOptions = {
  timeoutMs?: number;
  maxMemoryMb?: number;
  // Samo za testove: drugačiji (npr. zaglavljen) worker
  createWorker?: (job: FileJob, maxMemoryMb: number) => Worker;
};

// Poziv MORA da ostane ovakav (doslovni new URL kao prvi argument): bundler (Turbopack) tako prepoznaje worker i
// pakuje ga uz zavisnosti. Sa promenljivom umesto doslovnog izraza povlači ceo projekat i build pada.
function startFileWorker(job: FileJob, maxMemoryMb: number): Worker {
  return new Worker(new URL('./file-worker.ts', import.meta.url), {
    workerData: job,
    resourceLimits: { maxOldGenerationSizeMb: maxMemoryMb },
  });
}

export function readFileInWorker(job: FileJob, options: FileReadOptions = {}): Promise<FileReadResult> {
  const timeoutMs = options.timeoutMs ?? FILE_READ_TIMEOUT_MS;
  const maxMemoryMb = options.maxMemoryMb ?? FILE_READ_MAX_MEMORY_MB;
  const createWorker = options.createWorker ?? startFileWorker;

  return new Promise<FileReadResult>((resolve) => {
    let worker: Worker;
    try {
      worker = createWorker(job, maxMemoryMb);
    } catch (error) {
      console.error('File worker: pokretanje nije uspelo:', error);
      resolve({ ok: false, reason: 'worker_failed' });
      return;
    }

    let settled = false;
    const finish = (result: FileReadResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Rezultat se vraća tek kad nit stvarno stane: terminate() prekida i petlju bez kraja
      void worker.terminate().finally(() => resolve(result));
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'parse_timeout' }), timeoutMs);

    worker.once('message', (message: FileReadResult) => finish(message));
    worker.once('error', (error: Error & { code?: string }) => {
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        finish({ ok: false, reason: 'archive_bomb', finding: 'worker_out_of_memory' });
        return;
      }
      console.error('File worker: greška:', error);
      finish({ ok: false, reason: 'worker_failed' });
    });
    worker.once('exit', () => finish({ ok: false, reason: 'worker_failed' }));
  });
}
