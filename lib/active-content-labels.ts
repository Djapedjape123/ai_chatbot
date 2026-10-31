// Nazivi nalaza aktivnog sadržaja (Faza 3) rečima koje advokat razume. Zajedničko za poruku koju vraća ruta
// (lib/upload-rejection.ts) i za prikaz u /activity (lib/activity.ts). Čist kod, bez Node API-ja.
import type { DocxRejection } from './docx-inspect.ts';
import type { PdfActiveFinding } from './pdf-inspect.ts';

export type ActiveFinding = PdfActiveFinding | Extract<DocxRejection, { reason: 'active_content' }>['finding'];

export const ACTIVE_CONTENT_LABELS: Record<ActiveFinding, string> = {
  pdf_javascript: 'JavaScript u PDF-u',
  pdf_launch: 'akcija koja pokreće drugi program',
  pdf_embedded_file: 'ugrađeni fajlovi (prilozi)',
  pdf_rich_media: 'ugrađen multimedijalni sadržaj',
  pdf_xfa: 'XFA obrazac',
  pdf_submit_form: 'dugme koje šalje podatke obrasca',
  pdf_import_data: 'uvoz podataka u obrazac',
  docx_macro: 'makroi',
  docx_embedded_object: 'ugrađeni objekti (OLE)',
  docx_activex: 'ActiveX kontrole',
  docx_remote_template: 'šablon koji se učitava sa interneta',
  docx_remote_object: 'veza ka objektu na internetu',
  docx_remote_frame: 'veza ka okviru sa interneta',
};
