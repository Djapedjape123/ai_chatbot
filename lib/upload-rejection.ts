// Pretvara razlog odbijanja fajla (Faza 3) u ono što ruta vraća i upisuje: HTTP status, kod, poruku na srpskom
// sa uputstvom šta korisnik treba da uradi, i metapodatke za audit (bez naziva fajla i bez sadržaja).
// Zajedničko za /api/ingest i /api/attachments/docx. Bez server-only importa, da bi se moglo testirati.
import { ACTIVE_CONTENT_LABELS } from './active-content-labels.ts';
import { FILE_READ_TIMEOUT_MS, type FileReadResult } from './file-read.ts';
import { PDF_MAX_PAGES } from './pdf-inspect.ts';
import type { ImageRejection } from './chat-images.ts';
import { IMAGE_MAX_BYTES, IMAGE_MAX_LONG_EDGE, IMAGE_MIN_LONG_EDGE, MAX_IMAGES_PER_QUESTION } from './image-limits.ts';

// Razlozi koji se odlučuju pre čitanja (po magičnim bajtovima), uz sve što vraća čitanje u worker-u
export type UploadRejection =
  | Exclude<FileReadResult, { ok: true }>
  | { ok: false; reason: 'unsupported_type' | 'legacy_doc' | 'encrypted_office' }
  // Slike sa telefona (Faza 3.5)
  | ImageRejection;

export type RejectionDescription = {
  status: number;
  code: string;
  message: string;
  // null = greška servera, ne korisnikovog fajla: ne upisuje se kao "blokirano otpremanje"
  audit: Record<string, string | number> | null;
};

// 'attachment' = Word prilog uz pitanje (ne ide u bazu znanja): tamo je dozvoljen samo Word.
// 'image' = slika uz pitanje ili strana slikanog dokumenta (Faza 3.5): dozvoljen je samo JPEG.
export function describeRejection(
  r: UploadRejection,
  context: 'document' | 'attachment' | 'image' = 'document'
): RejectionDescription {
  switch (r.reason) {
    case 'unsupported_type':
      return {
        status: 400,
        code: 'unsupported_type',
        message:
          context === 'image'
            ? 'Slika mora biti JPEG fotografija. Slikajte dokument kamerom telefona (ili izaberite sliku iz galerije) i pošaljite ponovo.'
            : context === 'attachment'
              ? 'Prilog uz pitanje može da bude samo Word dokument (.docx). PDF se dodaje u bazu znanja.'
              : 'Ovaj tip fajla nije podržan. Dozvoljeni su PDF i Word (.docx) dokumenti.',
        audit: { reason: 'unsupported_type' },
      };
    case 'legacy_doc':
      return {
        status: 400,
        code: 'legacy_doc',
        message: 'Stari Word format (.doc) nije podržan. Otvorite fajl u Wordu, izaberite Sačuvaj kao (.docx) i otpremite ga ponovo.',
        audit: { reason: 'legacy_doc' },
      };
    case 'encrypted_office':
      return {
        status: 400,
        code: 'encrypted_office',
        message: 'Word dokument je zaštićen lozinkom ili je u starom formatu. Sačuvajte ga kao .docx bez lozinke i otpremite ponovo.',
        audit: { reason: 'encrypted_office' },
      };
    case 'encrypted_pdf':
      return {
        status: 400,
        code: 'encrypted_pdf',
        message: 'PDF je zaštićen lozinkom za otvaranje. Uklonite lozinku (u PDF čitaču ili štampom u novi PDF) i otpremite ga ponovo.',
        audit: { reason: 'encrypted_pdf' },
      };
    case 'unreadable_pdf':
      return {
        status: 400,
        code: 'invalid_pdf',
        message: 'Fajl nije ispravan PDF ili je oštećen.',
        audit: { reason: 'unreadable_pdf' },
      };
    case 'unreadable_docx':
      return {
        status: 400,
        code: 'invalid_docx',
        message: 'Fajl nije ispravan Word dokument (.docx) ili je oštećen.',
        audit: { reason: 'unreadable_docx', finding: r.finding },
      };
    case 'active_content':
      return {
        status: 400,
        code: 'active_content',
        message:
          `Fajl sadrži aktivan sadržaj (${ACTIVE_CONTENT_LABELS[r.finding]}), koji se ne prihvata. ` +
          'Sačuvajte čistu kopiju bez njega (Word: Sačuvaj kao .docx bez makroa i ugrađenih objekata; PDF: štampajte u novi PDF) i otpremite je ponovo.',
        audit: { reason: 'active_content', finding: r.finding },
      };
    case 'archive_bomb':
      return {
        status: 400,
        code: 'archive_bomb',
        message: 'Fajl je neobično velik ili složen kada se raspakuje, pa se ne obrađuje.',
        audit: { reason: 'archive_bomb', finding: r.finding },
      };
    case 'too_many_pages':
      return {
        status: 400,
        code: 'too_many_pages',
        message: `PDF ima ${r.pages} strana, a najviše je dozvoljeno ${PDF_MAX_PAGES}. Podelite ga na manje delove i otpremite ponovo.`,
        audit: { reason: 'too_many_pages', pages: r.pages },
      };
    case 'parse_timeout':
      return {
        status: 422,
        code: 'parse_timeout',
        message: `Obrada fajla traje predugo (preko ${FILE_READ_TIMEOUT_MS / 1000} sekundi) pa je prekinuta. Pokušajte sa manjim ili jednostavnijim fajlom.`,
        audit: { reason: 'parse_timeout' },
      };
    case 'image_too_large':
      return {
        status: 400,
        code: 'image_too_large',
        message: `Slika je prevelika (najviše ${IMAGE_MAX_BYTES / 1024}KB). Slikajte dokument ponovo; aplikacija sama smanjuje sliku pre slanja.`,
        audit: { reason: 'image_too_large' },
      };
    case 'image_dimensions':
      return {
        status: 400,
        code: 'image_dimensions',
        message:
          `Slika ima neodgovarajuće dimenzije (${r.width} x ${r.height} piksela). Najduža stranica mora biti između ` +
          `${IMAGE_MIN_LONG_EDGE} i ${IMAGE_MAX_LONG_EDGE} piksela; slikajte dokument ponovo.`,
        audit: { reason: 'image_dimensions', width: r.width, height: r.height },
      };
    case 'unreadable_image':
      return {
        status: 400,
        code: 'unreadable_image',
        message: 'Slika je oštećena ili nije ispravan JPEG. Slikajte dokument ponovo.',
        audit: { reason: 'unreadable_image', finding: r.finding },
      };
    case 'image_count':
      // Pregledač ovo ne dozvoljava, pa je ovo ručno sastavljen zahtev: ne beleži se kao blokirano otpremanje
      return {
        status: 400,
        code: 'image_count',
        message: `Uz jedno pitanje pošaljite od 1 do ${MAX_IMAGES_PER_QUESTION} slika.`,
        audit: null,
      };
    case 'worker_failed':
      return {
        status: 500,
        code: 'file_read_failed',
        message: 'Došlo je do greške pri obradi fajla. Pokušajte ponovo.',
        audit: null,
      };
  }
}
