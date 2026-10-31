// Čitanje .docx-a sa proverom (Faza 3, korak 3.2): prvo lib/docx-inspect.ts (zip bomba, aktivan sadržaj), tek
// onda mammoth izvlači tekst. Kao i lib/pdf-read.ts, radi u istom procesu kao pozivalac: ruta je pokreće u
// worker-u sa ograničenjem vremena (lib/file-read.ts). Bez server-only importa, da bi se moglo testirati.
import mammoth from 'mammoth';
import { inspectDocx, type DocxRejection } from './docx-inspect.ts';

export type DocxReadResult = { ok: true; text: string } | DocxRejection;

export async function readDocx(bytes: Uint8Array): Promise<DocxReadResult> {
  const inspection = inspectDocx(bytes);
  if (!inspection.ok) return inspection;

  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { ok: true, text: value };
  } catch {
    return { ok: false, reason: 'unreadable_docx', finding: 'mammoth_failed' };
  }
}
