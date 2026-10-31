// Pretvara razlog odbijanja fajla (Faza 3) u ono što ruta vraća i upisuje: HTTP status, kod, poruku na srpskom
// sa uputstvom šta korisnik treba da uradi, i metapodatke za audit (bez naziva fajla i bez sadržaja).
// Zajedničko za /api/ingest i /api/attachments/docx. Bez server-only importa, da bi se moglo testirati.
import { ACTIVE_CONTENT_LABELS } from './active-content-labels.ts';
import { FILE_READ_TIMEOUT_MS, type FileReadResult } from './file-read.ts';
import { PDF_MAX_PAGES } from './pdf-inspect.ts';

// Razlozi koji se odlučuju pre čitanja (po magičnim bajtovima), uz sve što vraća čitanje u worker-u
export type UploadRejection =
  | Exclude<FileReadResult, { ok: true }>
  | { ok: false; reason: 'unsupported_type' | 'legacy_doc' | 'encrypted_office' };

export type RejectionDescription = {
  status: number;
  code: string;
  message: string;
  // null = greška servera, ne korisnikovog fajla: ne upisuje se kao "blokirano otpremanje"
  audit: Record<string, string | number> | null;
};

// 'attachment' = Word prilog uz pitanje (ne ide u bazu znanja): tamo je dozvoljen samo Word
export function describeRejection(r: UploadRejection, context: 'document' | 'attachment' = 'document'): RejectionDescription {
  switch (r.reason) {
    case 'unsupported_type':
      return {
        status: 400,
        code: 'unsupported_type',
        message:
          context === 'attachment'
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
    case 'worker_failed':
      return {
        status: 500,
        code: 'file_read_failed',
        message: 'Došlo je do greške pri obradi fajla. Pokušajte ponovo.',
        audit: null,
      };
  }
}
