// Ulazna tačka worker niti za čitanje PDF/Word fajla (Faza 3, korak 3.4). Pokreće je lib/file-read.ts.
// Parser (pdf.js, mammoth) ovde može da se zaglavi ili potroši memoriju bez ikakve posledice po ostatak servera:
// pozivalac nit prekida posle isteka vremena. Bez server-only importa, da bi se moglo testirati.
import { parentPort, workerData } from 'node:worker_threads';
import { readDocx } from './docx-read.ts';
import { readPdf } from './pdf-read.ts';
import type { FileJob } from './file-read.ts';

async function run() {
  const job = workerData as FileJob;
  const result = job.kind === 'pdf' ? await readPdf(job.bytes) : await readDocx(job.bytes);
  parentPort?.postMessage(result);
}

void run();
