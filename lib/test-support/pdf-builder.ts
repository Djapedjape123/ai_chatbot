// SAMO ZA TESTOVE: pravi PDF uzorke u memoriji (bez binarnih fajlova u repou i bez pravog malvera).
// Pokriva ono što Faza 3 proverava: običan PDF, PDF sa kompresovanim tokom objekata (PDF 1.5: ObjStm + XRef tok),
// šifrovan PDF (RC4 40-bit, standardni rukovalac) i sadržaj sa aktivnim elementima (JavaScript, Launch, ...).
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const encoder = new TextEncoder();

export type PdfObject = {
  num: number;
  // Sadržaj rečnika/vrednosti objekta, npr. "<< /Type /Catalog /Pages 2 0 R >>"
  body: string;
  // Ako postoji, objekat je tok (stream); /Length se dopisuje sam
  stream?: string | Uint8Array;
};

export type BuildPdfOptions = {
  // Broj objekta kataloga (podrazumevano 1)
  root?: number;
  // Objekti koji se pakuju u kompresovan tok objekata (PDF 1.5). Tokovi ne mogu da se pakuju.
  compress?: number[];
  // Šifrovanje: lozinka korisnika ('' = otvara se bez lozinke, a ima samo vlasničku)
  encrypt?: { userPassword: string; ownerPassword?: string };
  // Smeće ispred %PDF- (specifikacija ga dozvoljava)
  prefix?: string;
};

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const bytes = (text: string) => encoder.encode(text);
const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join('');
const md5 = (data: Uint8Array) => new Uint8Array(createHash('md5').update(data).digest());

// --- RC4 i standardni rukovalac (R2, 40 bita) ---

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + s[a]) & 0xff;
    [s[a], s[b]] = [s[b], s[a]];
    out[k] = data[k] ^ s[(s[a] + s[b]) & 0xff];
  }
  return out;
}

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function padPassword(password: string): Uint8Array {
  return concat([bytes(password), PAD]).slice(0, 32);
}

const FILE_ID = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const PERMISSIONS = Uint8Array.from([0xfc, 0xff, 0xff, 0xff]); // /P -4

function encryptionSetup(userPassword: string, ownerPassword: string) {
  const o = rc4(md5(padPassword(ownerPassword)).slice(0, 5), padPassword(userPassword));
  const key = md5(concat([padPassword(userPassword), o, PERMISSIONS, FILE_ID])).slice(0, 5);
  const u = rc4(key, PAD);
  return { o, u, key };
}

function objectKey(fileKey: Uint8Array, num: number): Uint8Array {
  return md5(concat([fileKey, Uint8Array.from([num & 0xff, (num >>> 8) & 0xff, (num >>> 16) & 0xff, 0, 0])])).slice(0, Math.min(fileKey.length + 5, 16));
}

// --- Gradnja ---

function objectBytes(obj: PdfObject, streamData?: Uint8Array): Uint8Array {
  if (streamData === undefined) return bytes(`${obj.num} 0 obj\n${obj.body}\nendobj\n`);
  const dict = obj.body.replace(/>>\s*$/, ` /Length ${streamData.length} >>`);
  return concat([bytes(`${obj.num} 0 obj\n${dict}\nstream\n`), streamData, bytes('\nendstream\nendobj\n')]);
}

export function buildPdf(objects: PdfObject[], options: BuildPdfOptions = {}): Uint8Array {
  const root = options.root ?? 1;
  const prefix = bytes(options.prefix ?? '');
  const header = bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');

  const all = objects.slice();
  let fileKey: Uint8Array | undefined;
  let encryptNum: number | undefined;
  if (options.encrypt) {
    const { o, u, key } = encryptionSetup(options.encrypt.userPassword, options.encrypt.ownerPassword ?? 'owner');
    fileKey = key;
    encryptNum = Math.max(...all.map((x) => x.num)) + 1;
    all.push({ num: encryptNum, body: `<< /Filter /Standard /V 1 /R 2 /O <${hex(o)}> /U <${hex(u)}> /P -4 >>` });
  }

  const streamBytes = (obj: PdfObject): Uint8Array | undefined => {
    if (obj.stream === undefined) return undefined;
    const raw = typeof obj.stream === 'string' ? bytes(obj.stream) : obj.stream;
    return fileKey && obj.num !== encryptNum ? rc4(objectKey(fileKey, obj.num), raw) : raw;
  };

  const compress = new Set(options.compress ?? []);
  const plain = all.filter((o) => !compress.has(o.num));
  const packed = all.filter((o) => compress.has(o.num));
  const parts: Uint8Array[] = [prefix, header];
  let offset = prefix.length + header.length;
  const offsets = new Map<number, number>();

  for (const obj of plain) {
    offsets.set(obj.num, offset);
    const chunk = objectBytes(obj, streamBytes(obj));
    parts.push(chunk);
    offset += chunk.length;
  }

  const size = Math.max(...all.map((o) => o.num)) + 1;
  const idEntry = `/ID [<${hex(FILE_ID)}> <${hex(FILE_ID)}>]`;
  const encryptEntry = encryptNum !== undefined ? ` /Encrypt ${encryptNum} 0 R` : '';

  if (packed.length === 0) {
    const xrefAt = offset;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let n = 1; n < size; n++) {
      const at = offsets.get(n);
      xref += at === undefined ? '0000000000 00000 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`;
    }
    parts.push(bytes(`${xref}trailer\n<< /Size ${size} /Root ${root} 0 R ${idEntry}${encryptEntry} >>\nstartxref\n${xrefAt}\n%%EOF\n`));
    return concat(parts);
  }

  // PDF 1.5: objekti u ObjStm, a tabela referenci je XRef tok
  const objStmNum = size;
  let header2 = '';
  let bodies = '';
  packed.forEach((o) => {
    header2 += `${o.num} ${bodies.length} `;
    bodies += `${o.body}\n`;
  });
  const objStmData = deflateSync(bytes(header2 + bodies));
  const objStm: PdfObject = {
    num: objStmNum,
    body: `<< /Type /ObjStm /N ${packed.length} /First ${header2.length} /Filter /FlateDecode >>`,
  };
  offsets.set(objStmNum, offset);
  // U šifrovanom PDF-u se šifruje i tok objekata (tabela referenci, XRef tok, ostaje otvorena)
  const objStmChunk = objectBytes(objStm, fileKey ? rc4(objectKey(fileKey, objStmNum), objStmData) : objStmData);
  parts.push(objStmChunk);
  offset += objStmChunk.length;

  const xrefNum = objStmNum + 1;
  const total = xrefNum + 1;
  const xrefAt = offset;
  const rows: number[] = [];
  const entry = (type: number, a: number, b: number) => rows.push(type, (a >>> 24) & 0xff, (a >>> 16) & 0xff, (a >>> 8) & 0xff, a & 0xff, (b >>> 8) & 0xff, b & 0xff);
  entry(0, 0, 0xffff);
  for (let n = 1; n < total; n++) {
    const index = packed.findIndex((o) => o.num === n);
    if (n === xrefNum) entry(1, xrefAt, 0);
    else if (index >= 0) entry(2, objStmNum, index);
    else if (offsets.has(n)) entry(1, offsets.get(n)!, 0);
    else entry(0, 0, 0);
  }
  const xref: PdfObject = {
    num: xrefNum,
    body: `<< /Type /XRef /Size ${total} /W [1 4 2] /Root ${root} 0 R ${idEntry}${encryptEntry} /Filter /FlateDecode >>`,
  };
  parts.push(objectBytes(xref, deflateSync(Uint8Array.from(rows))));
  parts.push(bytes(`startxref\n${xrefAt}\n%%EOF\n`));
  return concat(parts);
}

// --- Gotovi uzorci ---

export const SAMPLE_TEXT = 'Zakon o obligacionim odnosima, clan 1';

// Katalog (1), stranice (2), strana (3), sadržaj (4), font (5)
export function basePdfObjects(options: { catalogExtra?: string; pageExtra?: string; text?: string; pages?: number } = {}): PdfObject[] {
  const pageCount = options.pages ?? 1;
  const objects: PdfObject[] = [
    { num: 1, body: `<< /Type /Catalog /Pages 2 0 R${options.catalogExtra ? ' ' + options.catalogExtra : ''} >>` },
  ];
  const kids: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const page = 10 + i * 2;
    kids.push(`${page} 0 R`);
    objects.push({
      num: page,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page + 1} 0 R /Resources << /Font << /F1 5 0 R >> >>${i === 0 && options.pageExtra ? ' ' + options.pageExtra : ''} >>`,
    });
    objects.push({
      num: page + 1,
      body: '<< >>',
      stream: `BT /F1 12 Tf 72 700 Td (${options.text ?? SAMPLE_TEXT}${pageCount > 1 ? ` ${i + 1}` : ''}) Tj ET`,
    });
  }
  objects.push({ num: 2, body: `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>` });
  objects.push({ num: 5, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });
  return objects.sort((a, b) => a.num - b.num);
}

export function basePdf(options: Parameters<typeof basePdfObjects>[0] & BuildPdfOptions = {}): Uint8Array {
  return buildPdf(basePdfObjects(options), options);
}
