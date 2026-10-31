// Prepoznavanje tipa fajla PO SADRŽAJU (magični bajtovi). Ime fajla i MIME tip dolaze od korisnika i ne koriste
// se za odluku. Bez server-only importa, da bi se moglo testirati (npm test).
//
// Pravilo "jedan tip = jedan parser": svaki fajl dobija tačno jedan tip, a čita ga samo parser za taj tip.
// ZIP sa %PDF- u prvih 1024 bajta zato ostaje ZIP (nikad PDF), pa ga pdf.js ne vidi.
import { readZipDirectory } from './zip-directory.ts';

export type FileKind =
  | 'pdf'
  | 'docx'
  // Stari Word (.doc), OLE kontejner. Šifrovan .docx je takođe OLE, ali ima tok EncryptedPackage.
  | 'legacy_doc'
  | 'encrypted_office'
  | 'unknown';

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
// Specifikacija dozvoljava smeće ispred zaglavlja, ali ga čitači traže samo u prvih 1024 bajta
const PDF_HEADER_WINDOW = 1024;
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// Imena tokova u OLE direktorijumu su UTF-16LE
const ENCRYPTED_PACKAGE = [...'EncryptedPackage'].flatMap((c) => [c.charCodeAt(0), 0]);

const DOCX_REQUIRED_ENTRIES = ['[Content_Types].xml', 'word/document.xml'];

function matchesAt(bytes: Uint8Array, pattern: number[], at: number): boolean {
  if (at < 0 || at + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i++) if (bytes[at + i] !== pattern[i]) return false;
  return true;
}

function contains(bytes: Uint8Array, pattern: number[]): boolean {
  const last = bytes.length - pattern.length;
  for (let i = 0; i <= last; i++) {
    if (bytes[i] === pattern[0] && matchesAt(bytes, pattern, i)) return true;
  }
  return false;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const last = Math.min(PDF_HEADER_WINDOW - PDF_HEADER.length, bytes.length - PDF_HEADER.length);
  for (let i = 0; i <= last; i++) {
    if (matchesAt(bytes, PDF_HEADER, i)) return true;
  }
  return false;
}

function isDocx(bytes: Uint8Array): boolean {
  // Odlučuje centralni direktorijum (njega čita i mammoth), ne lokalna zaglavlja
  const entries = readZipDirectory(bytes);
  if (!entries) return false;
  const names = new Set(entries.map((e) => e.name));
  return DOCX_REQUIRED_ENTRIES.every((name) => names.has(name));
}

export function detectFileType(bytes: Uint8Array): FileKind {
  if (matchesAt(bytes, OLE_SIGNATURE, 0)) {
    return contains(bytes, ENCRYPTED_PACKAGE) ? 'encrypted_office' : 'legacy_doc';
  }
  if (matchesAt(bytes, ZIP_LOCAL_HEADER, 0)) {
    return isDocx(bytes) ? 'docx' : 'unknown';
  }
  return hasPdfHeader(bytes) ? 'pdf' : 'unknown';
}
