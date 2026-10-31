// SAMO ZA TESTOVE: pravi ZIP (i .docx uzorke) u memoriji, bez binarnih fajlova u repou i bez pravog malvera.
// Namerno ume i da laže (deklarisane veličine, potpis, ZIP64 oznake), da bi se proverile odbrane čitača.
import { crc32, deflateRawSync } from 'node:zlib';

export type ZipSpecEntry = {
  name: string;
  data?: Uint8Array | string;
  method?: 'deflate' | 'store';
  // Laže u zaglavljima (centralni direktorijum i lokalno zaglavlje), podaci ostaju pravi
  declaredUncompressedSize?: number;
  declaredCompressedSize?: number;
  // Prepisuje bit-flagove i kod metoda u zaglavljima (npr. 0x0001 = šifrovano, metod 99 = nepoznat)
  flags?: number;
  methodCode?: number;
  // Zamenjuje spakovane bajtove (npr. oštećen deflate tok); deklarisane veličine ostaju tačne za originalne podatke
  packedBytes?: Uint8Array;
  // Kvari potpis lokalnog zaglavlja (centralni direktorijum ostaje ispravan)
  badLocalSignature?: boolean;
};

export type ZipOptions = {
  comment?: string;
  // Pomak centralnog direktorijuma u EOCD-u (podrazumevano pravi); 0xffffffff je ZIP64 oznaka
  centralDirectoryOffset?: number;
  // Broj stavki u EOCD-u (podrazumevano pravi)
  declaredEntryCount?: number;
};

const encoder = new TextEncoder();

function bytesOf(data: Uint8Array | string | undefined): Uint8Array {
  if (data === undefined) return new Uint8Array(0);
  return typeof data === 'string' ? encoder.encode(data) : data;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function buildZip(entries: ZipSpecEntry[], options: ZipOptions = {}): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const raw = bytesOf(entry.data);
    const store = entry.method === 'store';
    const packed = entry.packedBytes ?? (store ? raw : deflateRawSync(raw));
    const name = encoder.encode(entry.name);
    const crc = crc32(raw);
    const compressedSize = entry.declaredCompressedSize ?? packed.length;
    const uncompressedSize = entry.declaredUncompressedSize ?? raw.length;
    const method = entry.methodCode ?? (store ? 0 : 8);
    const flags = entry.flags ?? 0x0800; // podrazumevano: imena su UTF-8

    const header = Uint8Array.from([
      ...u32(entry.badLocalSignature ? 0x0badf00d : 0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(compressedSize), ...u32(uncompressedSize), ...u16(name.length), ...u16(0),
    ]);
    local.push(header, name, packed);

    central.push(
      Uint8Array.from([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(compressedSize), ...u32(uncompressedSize), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]),
      name
    );
    offset += header.length + name.length + packed.length;
  }

  const directory = concat(central);
  const comment = encoder.encode(options.comment ?? '');
  const count = options.declaredEntryCount ?? entries.length;
  const end = Uint8Array.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count),
    ...u32(directory.length), ...u32(options.centralDirectoryOffset ?? offset), ...u16(comment.length),
  ]);

  return concat([...local, directory, end, comment]);
}

// Najmanji ispravan .docx (bez makroa i spoljnih veza). Dodatne stavke se dopisuju ili zamenjuju po imenu.
export function buildDocx(extra: ZipSpecEntry[] = [], options: ZipOptions = {}): Uint8Array {
  const base: ZipSpecEntry[] = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        '<w:p><w:r><w:t>Član 1. Ugovorne strane se saglašavaju o sledećem.</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    },
  ];
  const byName = new Map(base.map((e) => [e.name, e]));
  for (const e of extra) byName.set(e.name, e);
  return buildZip([...byName.values()], options);
}

// OLE (Compound File) zaglavlje: potpis starih .doc fajlova i šifrovanih Office fajlova
export const OLE_SIGNATURE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// Ime toka u OLE direktorijumu je UTF-16LE
export function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = text.charCodeAt(i) >>> 8;
  }
  return out;
}

export function joinBytes(...parts: Uint8Array[]): Uint8Array {
  return concat(parts);
}
