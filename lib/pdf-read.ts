// Čitanje PDF-a sa svim proverama (Faza 3, korak 3.3). Redosled je bitan: jeftino pre skupog.
//   1. struktura fajla (aktivan sadržaj, bomba u tokovima objekata): pre nego što pdf.js išta parsira;
//   2. otvaranje (šifrovan ili oštećen fajl);
//   3. broj strana (granica važi PRE izvlačenja teksta);
//   4. pdf.js pregled dokumenta (aktivan sadržaj koji sloj 1 ne vidi);
//   5. tekst.
// Ova funkcija je CPU-intenzivna i radi u istom procesu kao pozivalac: ruta je pokreće u worker-u sa
// ograničenjem vremena (lib/file-worker.ts, korak 3.4). Bez server-only importa, da bi se moglo testirati.
import { extractText, getDocumentProxy } from 'unpdf';
import {
  PDF_MAX_PAGES,
  inspectPdfDocument,
  scanPdfStructure,
  type PdfActiveFinding,
} from './pdf-inspect.ts';

export type PdfReadResult =
  | { ok: true; text: string; pages: number }
  | { ok: false; reason: 'encrypted_pdf' | 'unreadable_pdf' }
  | { ok: false; reason: 'too_many_pages'; pages: number }
  | { ok: false; reason: 'active_content'; finding: PdfActiveFinding }
  | { ok: false; reason: 'archive_bomb'; finding: 'pdf_object_stream_too_large' };

export async function readPdf(bytes: Uint8Array): Promise<PdfReadResult> {
  const scan = scanPdfStructure(bytes);
  if (scan.kind === 'active_content') return { ok: false, reason: 'active_content', finding: scan.finding };
  if (scan.kind === 'archive_bomb') return { ok: false, reason: 'archive_bomb', finding: scan.finding };

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js preuzima (prazni) prosleđeni bafer, pa mu se daje kopija: pozivalac zadržava svoje bajtove
    pdf = await getDocumentProxy(bytes.slice());
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') return { ok: false, reason: 'encrypted_pdf' };
    return { ok: false, reason: 'unreadable_pdf' };
  }

  try {
    if (pdf.numPages > PDF_MAX_PAGES) return { ok: false, reason: 'too_many_pages', pages: pdf.numPages };

    const finding = await inspectPdfDocument(pdf);
    if (finding) return { ok: false, reason: 'active_content', finding };

    const { text } = await extractText(pdf, { mergePages: true });
    return { ok: true, text, pages: pdf.numPages };
  } catch {
    return { ok: false, reason: 'unreadable_pdf' };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
