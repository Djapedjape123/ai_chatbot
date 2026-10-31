// Provera .docx fajla PRE nego što ga mammoth pročita (Faza 3, korak 3.2). Bez server-only importa, da bi se
// moglo testirati (npm test), ali koristi node:zlib: poziva se samo iz Node ruta i worker-a.
//
// Šta se proverava:
//  1. zip bomba: broj stavki, zbir raspakovanih veličina i odnos po stavci iz centralnog direktorijuma, a pošto
//     zaglavlje može da laže, i STVARNA veličina svake stavke (ograničeno raspakivanje, izlaz je ograničen
//     deklarisanom veličinom, pa bomba ne može da zauzme memoriju);
//  2. aktivan sadržaj: makroi, ugrađeni OLE objekti, ActiveX, udaljeni šabloni (veze izvan fajla).
// Fajl se ne čisti: ili prolazi (i od njega ostaje samo tekst) ili se odbija.
import { inflateRawSync } from 'node:zlib';
import { readZipDirectory, type ZipEntry } from './zip-directory.ts';

export const DOCX_MAX_UNCOMPRESSED = 50 * 1024 * 1024;
export const DOCX_MAX_ENTRIES = 2000;
export const DOCX_MAX_RATIO = 100;
// Odnos se proverava samo za stavke od ove veličine: male ne mogu da naškode (zbir je ograničen), a nule ili
// ponovljen tekst u maloj stavci daju visok odnos i bez ikakve zlonamernosti.
const RATIO_MIN_ENTRY_SIZE = 64 * 1024;
// Content Types i .rels su sitni; sve preko ovoga nije običan Word fajl
const MAX_META_PART_SIZE = 5 * 1024 * 1024;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_LENGTH = 30;

export type DocxRejection =
  | { ok: false; reason: 'archive_bomb'; finding: 'zip_entries' | 'zip_uncompressed_size' | 'zip_ratio' | 'zip_size_mismatch' }
  | {
      ok: false;
      reason: 'active_content';
      finding:
        | 'docx_macro'
        | 'docx_embedded_object'
        | 'docx_activex'
        | 'docx_remote_template'
        | 'docx_remote_object'
        | 'docx_remote_frame';
    }
  | { ok: false; reason: 'unreadable_docx'; finding: string };

export type DocxInspection = { ok: true } | DocxRejection;

const unreadable = (finding: string): DocxRejection => ({ ok: false, reason: 'unreadable_docx', finding });

// Ime stavke kako ga vidi Office: obrnute kose crte i %-kodiranje ne smeju da sakriju ime, velika slova su svejedno
function normalizeName(name: string): string {
  let n = name.replace(/\\/g, '/');
  if (n.includes('%')) {
    try {
      n = decodeURIComponent(n);
    } catch {
      // neispravno kodiranje ostaje kakvo jeste
    }
  }
  return n.toLowerCase();
}

function activeContentByName(name: string): Extract<DocxRejection, { reason: 'active_content' }>['finding'] | null {
  const n = normalizeName(name);
  const path = '/' + n;
  if (n.includes('vbaproject') || n.endsWith('vbadata.xml')) return 'docx_macro';
  if (n.includes('oleobject') || (path.includes('/embeddings/') && n.endsWith('.bin'))) return 'docx_embedded_object';
  if (path.includes('/activex/')) return 'docx_activex';
  return null;
}

// XML dokument u Office paketu sme da bude UTF-8 ili UTF-16 (sa BOM-om ili bez njega)
function decodeXml(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0x3c && bytes[1] === 0x00) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0x00 && bytes[1] === 0x3c) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Numerički i osnovni imenovani entiteti: "&#69;xternal" je za XML parser isto što i "External"
function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z]+));/g, (whole, hex, dec, named) => {
    if (named) return NAMED_ENTITIES[named] ?? whole;
    const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

// Veze (<Relationship>) iz .rels dokumenta. Ručni čitač, linearan: nebalansirani navodnici, komentari i ">" u
// vrednostima atributa ne smeju ni da uspore proveru ni da sakriju vezu.
function readRelationships(xml: string): Map<string, string>[] {
  const found: Map<string, string>[] = [];
  const len = xml.length;
  let i = 0;
  while (i < len) {
    const open = xml.indexOf('<', i);
    if (open === -1) break;
    i = open + 1;

    if (xml.startsWith('!--', i)) {
      const end = xml.indexOf('-->', i + 3);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (xml.startsWith('![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 8);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (xml[i] === '?' || xml[i] === '!') {
      const end = xml.indexOf('>', i);
      i = end === -1 ? len : end + 1;
      continue;
    }

    const nameStart = i;
    while (i < len && !isSpace(xml[i]) && xml[i] !== '>' && xml[i] !== '/') i++;
    const tag = xml.slice(nameStart, i);
    const local = tag.slice(tag.lastIndexOf(':') + 1).toLowerCase();

    const attrs = new Map<string, string>();
    while (i < len && xml[i] !== '>') {
      if (isSpace(xml[i]) || xml[i] === '/') {
        i++;
        continue;
      }
      const attrStart = i;
      while (i < len && !isSpace(xml[i]) && xml[i] !== '=' && xml[i] !== '>' && xml[i] !== '/') i++;
      const attr = xml.slice(attrStart, i).toLowerCase();
      while (i < len && isSpace(xml[i])) i++;
      if (xml[i] !== '=') continue;
      i++;
      while (i < len && isSpace(xml[i])) i++;
      let value: string;
      if (xml[i] === '"' || xml[i] === "'") {
        const quote = xml[i];
        const end = xml.indexOf(quote, i + 1);
        if (end === -1) {
          i = len;
          break;
        }
        value = xml.slice(i + 1, end);
        i = end + 1;
      } else {
        const valueStart = i;
        while (i < len && !isSpace(xml[i]) && xml[i] !== '>') i++;
        value = xml.slice(valueStart, i);
      }
      if (attr && !attrs.has(attr)) attrs.set(attr, decodeEntities(value).trim());
    }
    if (local === 'relationship') found.push(attrs);
    if (i < len) i++; // preskače '>'
  }
  return found;
}

function remoteFinding(xml: string): Extract<DocxRejection, { reason: 'active_content' }>['finding'] | null {
  for (const rel of readRelationships(xml)) {
    if ((rel.get('targetmode') ?? '').toLowerCase() !== 'external') continue;
    const type = (rel.get('type') ?? '').toLowerCase();
    const kind = type.slice(type.lastIndexOf('/') + 1);
    if (kind === 'attachedtemplate') return 'docx_remote_template';
    if (kind === 'oleobject') return 'docx_remote_object';
    if (kind === 'frame') return 'docx_remote_frame';
  }
  return null;
}

type Unpacked = { ok: true; data: Uint8Array } | { ok: false; rejection: DocxRejection };

// Raspakuje JEDNU stavku, ali najviše onoliko koliko zaglavlje deklariše. Veće ili manje od toga je laž.
function unpack(bytes: Uint8Array, view: DataView, entry: ZipEntry): Unpacked {
  const at = entry.localHeaderOffset;
  if (at + LOCAL_HEADER_LENGTH > bytes.length || view.getUint32(at, true) !== LOCAL_SIGNATURE) {
    return { ok: false, rejection: unreadable('zip_local_header') };
  }
  const start = at + LOCAL_HEADER_LENGTH + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.length) return { ok: false, rejection: unreadable('zip_data_out_of_range') };

  const packed = bytes.subarray(start, end);
  const mismatch: Unpacked = { ok: false, rejection: { ok: false, reason: 'archive_bomb', finding: 'zip_size_mismatch' } };

  if (entry.method === 0) {
    return packed.length === entry.uncompressedSize ? { ok: true, data: packed } : mismatch;
  }
  try {
    const data = inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    return data.length === entry.uncompressedSize ? { ok: true, data } : mismatch;
  } catch (error) {
    if (error instanceof RangeError) return mismatch; // izlaz je veći od deklarisanog
    return { ok: false, rejection: unreadable('zip_corrupt_entry') };
  }
}

export function inspectDocx(bytes: Uint8Array): DocxInspection {
  const entries = readZipDirectory(bytes);
  if (!entries) return unreadable('zip_directory');

  // 1. Zip bomba po zaglavlju (jeftino, pre ikakvog raspakivanja)
  if (entries.length > DOCX_MAX_ENTRIES) return { ok: false, reason: 'archive_bomb', finding: 'zip_entries' };
  const declaredTotal = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (declaredTotal > DOCX_MAX_UNCOMPRESSED) return { ok: false, reason: 'archive_bomb', finding: 'zip_uncompressed_size' };
  for (const e of entries) {
    if (e.uncompressedSize >= RATIO_MIN_ENTRY_SIZE && e.uncompressedSize > e.compressedSize * DOCX_MAX_RATIO) {
      return { ok: false, reason: 'archive_bomb', finding: 'zip_ratio' };
    }
  }

  // 2. Aktivan sadržaj po imenu stavke
  for (const e of entries) {
    const finding = activeContentByName(e.name);
    if (finding) return { ok: false, reason: 'active_content', finding };
  }

  // 3. Stvarna veličina svake stavke + čitanje sitnih XML delova (Content Types i veze)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const xmlParts: string[] = [];
  const relParts: string[] = [];
  for (const e of entries) {
    if ((e.flags & 0x0001) !== 0) return unreadable('zip_encrypted_entry');
    if (e.method !== 0 && e.method !== 8) return unreadable('zip_method');

    const unpacked = unpack(bytes, view, e);
    if (!unpacked.ok) return unpacked.rejection;

    const name = normalizeName(e.name);
    const isContentTypes = name === '[content_types].xml';
    const isRels = name.endsWith('.rels');
    if (isContentTypes || isRels) {
      if (unpacked.data.length > MAX_META_PART_SIZE) return unreadable('xml_part_too_large');
      const text = decodeXml(unpacked.data);
      // Office paket ne sme da ima DTD; entiteti iz DTD-a su još jedan način da se sakrije sadržaj
      if (/<!doctype/i.test(text)) return unreadable('xml_dtd');
      (isContentTypes ? xmlParts : relParts).push(text);
    }
  }

  // 4. Aktivan sadržaj po sadržaju: makro u tipu dokumenta (.docm preimenovan u .docx) i udaljene veze
  for (const text of xmlParts) {
    const lower = decodeEntities(text).toLowerCase();
    if (lower.includes('macroenabled') || lower.includes('vbaproject')) return { ok: false, reason: 'active_content', finding: 'docx_macro' };
  }
  for (const text of relParts) {
    const finding = remoteFinding(text);
    if (finding) return { ok: false, reason: 'active_content', finding };
  }

  return { ok: true };
}
