// Provera aktivnog sadržaja u PDF-u (Faza 3, korak 3.3). Bez server-only importa, da bi se moglo testirati
// (npm test), ali koristi node:zlib: poziva se samo iz Node ruta i worker-a.
//
// Dva sloja, jer nijedan sam ne vidi sve:
//  (a) scanPdfStructure: čita STRUKTURU fajla (imena objekata), uključujući raspakovan sadržaj tokova objekata
//      (ObjStm), gde moderni PDF-ovi drže akcije. pdf.js JavaScript akciju na linku preskače bez traga, pa
//      se to vidi samo ovde. Preskaču se stringovi, komentari i tokovi (slike i sadržaj strana): slučajni
//      binarni podaci bi inače davali lažne pogotke, a korisnik nema opciju "Ipak dodaj".
//  (b) inspectPdfDocument: pita otvoren pdf.js dokument (JavaScript u dokumentu i poljima, prilozi, anotacije
//      priloga i RichMedia). Pokriva i šifrovane PDF-ove sa samo vlasničkom lozinkom, čiji su ObjStm nečitljivi
//      sloju (a).
// Poznata praznina: akcija na linku sakrivena u ObjStm-u šifrovanog PDF-a ili u ObjStm-u sa filterom koji nije
// Flate nije vidljiva nijednom sloju.
import { inflateSync } from 'node:zlib';
import type { getDocumentProxy } from 'unpdf';

export const PDF_MAX_PAGES = 300;
// Zbir raspakovanih tokova objekata. Pravi ObjStm je veličine strukture dokumenta (par MB najviše).
export const PDF_MAX_OBJECT_STREAM_BYTES = 50 * 1024 * 1024;

export type PdfActiveFinding =
  | 'pdf_javascript'
  | 'pdf_launch'
  | 'pdf_embedded_file'
  | 'pdf_rich_media'
  | 'pdf_xfa'
  | 'pdf_submit_form'
  | 'pdf_import_data';

export type PdfScan =
  | { kind: 'clean' }
  | { kind: 'active_content'; finding: PdfActiveFinding }
  | { kind: 'archive_bomb'; finding: 'pdf_object_stream_too_large' };

// Poređenje je tačno (PDF imena razlikuju velika i mala slova), pa /JavaScripts ili /LaunchPad nisu pogodak
const DANGEROUS_NAMES = new Map<string, PdfActiveFinding>([
  ['JavaScript', 'pdf_javascript'],
  ['JS', 'pdf_javascript'],
  ['Launch', 'pdf_launch'],
  ['EmbeddedFile', 'pdf_embedded_file'],
  ['EmbeddedFiles', 'pdf_embedded_file'],
  ['RichMedia', 'pdf_rich_media'],
  ['XFA', 'pdf_xfa'],
  ['SubmitForm', 'pdf_submit_form'],
  ['ImportData', 'pdf_import_data'],
]);

const MAX_NAME_LENGTH = 64;
const CLEAN: PdfScan = { kind: 'clean' };

const isWhite = (c: number) => c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
const isDelimiter = (c: number) =>
  c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

// Ime sa #xx zapisom ("/J#61vaScript") je za PDF isto što i "/JavaScript"
function decodeName(data: Uint8Array, from: number, to: number): string {
  let name = '';
  for (let k = from; k < to; k++) {
    if (data[k] === 0x23 && k + 2 < to) {
      const hi = hexValue(data[k + 1]);
      const lo = hexValue(data[k + 2]);
      if (hi >= 0 && lo >= 0) {
        name += String.fromCharCode(hi * 16 + lo);
        k += 2;
        continue;
      }
    }
    name += String.fromCharCode(data[k]);
  }
  return name;
}

function latin1(data: Uint8Array, from: number, to: number): string {
  let s = '';
  for (let k = from; k < to; k++) s += String.fromCharCode(data[k]);
  return s;
}

function skipLiteralString(data: Uint8Array, start: number): number {
  let depth = 0;
  let i = start;
  while (i < data.length) {
    const c = data[i];
    if (c === 0x5c) {
      i += 2; // obrnuta kosa crta "pojede" sledeći bajt, i zagradu
      continue;
    }
    if (c === 0x28) depth++;
    else if (c === 0x29 && --depth === 0) return i + 1;
    i++;
  }
  return data.length;
}

const END_STREAM = Buffer.from('endstream', 'latin1');

function scanBuffer(data: Uint8Array, budget: { remaining: number }, depth: number): PdfScan {
  const n = data.length;
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  // Imena u tekućem objektu: samo da bi se znalo da li je tok objekata (ObjStm) koji treba raspakovati
  let objectNames = new Set<string>();
  let i = 0;

  while (i < n) {
    const c = data[i];
    if (isWhite(c)) {
      i++;
    } else if (c === 0x25) {
      // komentar do kraja reda
      while (i < n && data[i] !== 0x0a && data[i] !== 0x0d) i++;
    } else if (c === 0x28) {
      i = skipLiteralString(data, i);
    } else if (c === 0x3c) {
      if (data[i + 1] === 0x3c) {
        i += 2; // početak rečnika
      } else {
        const end = data.indexOf(0x3e, i + 1); // heksadecimalni string
        i = end === -1 ? n : end + 1;
      }
    } else if (c === 0x3e || c === 0x29 || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i++;
    } else if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !isWhite(data[j]) && !isDelimiter(data[j])) j++;
      if (j - (i + 1) <= MAX_NAME_LENGTH) {
        const name = decodeName(data, i + 1, j);
        const finding = DANGEROUS_NAMES.get(name);
        if (finding) return { kind: 'active_content', finding };
        objectNames.add(name);
      }
      i = j;
    } else {
      let j = i;
      while (j < n && !isWhite(data[j]) && !isDelimiter(data[j])) j++;
      if (j === i) j = i + 1;
      const length = j - i;
      const token = length === 3 || length === 6 ? latin1(data, i, j) : '';
      i = j;

      if (token === 'obj' || token === 'endobj') {
        objectNames = new Set();
      } else if (token === 'stream') {
        if (data[i] === 0x0d && data[i + 1] === 0x0a) i += 2;
        else if (data[i] === 0x0a || data[i] === 0x0d) i += 1;
        const end = buffer.indexOf(END_STREAM, i);
        const dataEnd = end === -1 ? n : end;

        if (depth === 0 && objectNames.has('ObjStm')) {
          const body = data.subarray(i, dataEnd);
          // Flate: raspakuje se (u okviru budžeta). Bez filtera: sadržaj je običan tekst objekata (važi u PDF 1.5).
          // Drugi filteri (LZW, ASCII85...) se ne čitaju: poznata praznina, vidi napomenu na vrhu fajla.
          let inner: PdfScan = CLEAN;
          if (objectNames.has('FlateDecode')) inner = scanObjectStream(body, budget);
          else if (!objectNames.has('Filter')) inner = scanBuffer(body, budget, 1);
          if (inner.kind !== 'clean') return inner;
        }
        i = end === -1 ? n : end + END_STREAM.length;
        objectNames = new Set();
      }
    }
  }
  return CLEAN;
}

function scanObjectStream(packed: Uint8Array, budget: { remaining: number }): PdfScan {
  if (budget.remaining <= 0) return { kind: 'archive_bomb', finding: 'pdf_object_stream_too_large' };
  let inflated: Uint8Array;
  try {
    inflated = inflateSync(packed, { maxOutputLength: budget.remaining });
  } catch (error) {
    // Izlaz veći od preostalog budžeta je bomba; oštećen tok ni pdf.js ne može da pročita, pa se preskače
    return error instanceof RangeError ? { kind: 'archive_bomb', finding: 'pdf_object_stream_too_large' } : CLEAN;
  }
  budget.remaining -= inflated.length;
  return scanBuffer(inflated, budget, 1);
}

export function scanPdfStructure(bytes: Uint8Array): PdfScan {
  return scanBuffer(bytes, { remaining: PDF_MAX_OBJECT_STREAM_BYTES }, 0);
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

const hasKeys = (value: unknown) => typeof value === 'object' && value !== null && Object.keys(value).length > 0;

// Sloj (b): ono što pdf.js zna o otvorenom dokumentu. Poziva se tek kad je broj strana u granici.
export async function inspectPdfDocument(pdf: PdfDocument): Promise<PdfActiveFinding | null> {
  if (hasKeys(await pdf.getJSActions())) return 'pdf_javascript';
  if (await pdf.hasJSActions()) return 'pdf_javascript';
  const attachments = await pdf.getAttachments();
  if (attachments && attachments.size > 0) return 'pdf_embedded_file';

  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    try {
      if (hasKeys(await page.getJSActions())) return 'pdf_javascript';
      for (const annotation of await page.getAnnotations()) {
        if (annotation.subtype === 'FileAttachment') return 'pdf_embedded_file';
        if (annotation.subtype === 'RichMedia') return 'pdf_rich_media';
        if (hasKeys(annotation.actions)) return 'pdf_javascript';
      }
    } finally {
      page.cleanup();
    }
  }
  return null;
}
