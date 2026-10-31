// Čita SAMO centralni direktorijum ZIP-a (spisak stavki sa deklarisanim veličinama), bez raspakivanja.
// Služi za prepoznavanje .docx-a (lib/file-type.ts) i za proveru pre čitanja (lib/docx-inspect.ts).
// Bez server-only importa i bez Node API-ja, da bi se moglo testirati (npm test).
//
// Čitač je NAMERNO strog: direktorijum mora da se završava tačno na EOCD zapisu, bez smeća ispred arhive,
// bez razmaka, bez ZIP64 oznaka (sa ograničenjem od 4MB legitiman fajl ih nema). Sve što odstupa je `null`.
// Razlog: ako bi naš čitač video drugačiji direktorijum nego mammoth (jszip), provera bi se odnosila na
// jedan fajl, a čitao bi se drugi.

export type ZipEntry = {
  name: string;
  flags: number;
  // 0 = bez kompresije, 8 = deflate
  method: number;
  compressedSize: number;
  // Deklarisano u direktorijumu: može da laže, pa je proveri lib/docx-inspect.ts stvarnim (ograničenim) raspakivanjem
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_LENGTH = 22;
const CENTRAL_HEADER_LENGTH = 46;
const LOCAL_HEADER_LENGTH = 30;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_16 = 0xffff;
const ZIP64_32 = 0xffffffff;

const decoder = new TextDecoder('utf-8');

// EOCD je na kraju fajla, ispred komentara arhive. Komentar sme da sadrži lažan potpis, pa se prihvata samo
// zapis čiji komentar stiže tačno do kraja fajla.
function findEndOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - EOCD_LENGTH;
  const first = Math.max(0, last - MAX_COMMENT_LENGTH);
  for (let pos = last; pos >= first; pos--) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE && pos + EOCD_LENGTH + view.getUint16(pos + 20, true) === view.byteLength) {
      return pos;
    }
  }
  return -1;
}

export function readZipDirectory(bytes: Uint8Array): ZipEntry[] | null {
  if (bytes.byteLength < EOCD_LENGTH) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return null;

  const disk = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const total = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);

  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== total) return null;
  if (total === ZIP64_16 || directorySize === ZIP64_32 || directoryOffset === ZIP64_32) return null;
  if (directoryOffset + directorySize !== eocd) return null;

  const entries: ZipEntry[] = [];
  let pos = directoryOffset;
  for (let i = 0; i < total; i++) {
    if (pos + CENTRAL_HEADER_LENGTH > eocd) return null;
    if (view.getUint32(pos, true) !== CENTRAL_SIGNATURE) return null;

    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    if (compressedSize === ZIP64_32 || uncompressedSize === ZIP64_32 || localHeaderOffset === ZIP64_32) return null;
    const next = pos + CENTRAL_HEADER_LENGTH + nameLength + extraLength + commentLength;
    if (next > eocd) return null;
    if (localHeaderOffset + LOCAL_HEADER_LENGTH > directoryOffset) return null;

    entries.push({
      name: decoder.decode(bytes.subarray(pos + CENTRAL_HEADER_LENGTH, pos + CENTRAL_HEADER_LENGTH + nameLength)),
      flags: view.getUint16(pos + 8, true),
      method: view.getUint16(pos + 10, true),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    pos = next;
  }

  // Direktorijum mora da se završi tačno na EOCD-u: višak bajtova znači da ga drugi čitač može čitati drugačije
  return pos === eocd ? entries : null;
}
