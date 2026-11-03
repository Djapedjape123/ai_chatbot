// SAMO ZA TESTOVE: pravi JPEG u memoriji, bez binarnih fajlova u repou. Struktura (markeri, segmenti, dužine) je
// ispravna, a entropijski podaci su veštački: lib/image-inspect.ts čita samo strukturu, ne dekodira piksele.
// Namerno ume i da laže (dužina segmenta, skraćen fajl, smeće posle kraja), da bi se proverile odbrane čitača.
import { joinBytes } from './zip-builder.ts';

export type JpegSegment = { marker: number; data: Uint8Array | string } | { raw: Uint8Array };

export type JpegSpec = {
  width?: number;
  height?: number;
  // 0xc0 baseline, 0xc2 progressive; ostali SOF markeri služe za testove odbijanja
  sofMarker?: number;
  components?: number;
  // Segmenti pre prvog SOF-a (npr. APP1 sa EXIF-om)
  before?: JpegSegment[];
  // Segmenti posle SOF-a, a pre prvog SOS-a
  afterFrame?: JpegSegment[];
  // Broj skenova (progressive ih ima više); između skenova idu `betweenScans`
  scans?: number;
  betweenScans?: JpegSegment[];
  // Bajtovi entropijskih podataka po skenu (podrazumevano mali niz sa FF00 i RST markerom)
  scanData?: Uint8Array;
  omitFrame?: boolean;
  omitScan?: boolean;
  omitEoi?: boolean;
  trailing?: Uint8Array;
};

const encoder = new TextEncoder();
const bytesOf = (data: Uint8Array | string) => (typeof data === 'string' ? encoder.encode(data) : data);

export function segment(marker: number, data: Uint8Array | string): Uint8Array {
  const body = bytesOf(data);
  const length = body.byteLength + 2;
  return joinBytes(Uint8Array.from([0xff, marker, length >> 8, length & 0xff]), body);
}

function renderSegments(list: JpegSegment[] = []): Uint8Array[] {
  return list.map((s) => ('raw' in s ? s.raw : segment(s.marker, s.data)));
}

export const DEFAULT_SCAN_DATA = Uint8Array.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a]);

export function frameSegment(marker: number, width: number, height: number, components: number): Uint8Array {
  const body = [8, height >> 8, height & 0xff, width >> 8, width & 0xff, components];
  for (let i = 1; i <= components; i++) body.push(i, 0x11, 0);
  return segment(marker, Uint8Array.from(body));
}

function scanSegment(components: number): Uint8Array {
  const body = [components];
  for (let i = 1; i <= components; i++) body.push(i, 0);
  body.push(0, 63, 0);
  return segment(0xda, Uint8Array.from(body));
}

export const DQT = segment(0xdb, new Uint8Array(65));
export const DHT = segment(0xc4, joinBytes(Uint8Array.of(0), new Uint8Array(16).fill(0), Uint8Array.of()));

export function buildJpeg(spec: JpegSpec = {}): Uint8Array {
  const width = spec.width ?? 1200;
  const height = spec.height ?? 900;
  const components = spec.components ?? 3;
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8), ...renderSegments(spec.before), DQT];
  if (!spec.omitFrame) parts.push(frameSegment(spec.sofMarker ?? 0xc0, width, height, components));
  parts.push(DHT, ...renderSegments(spec.afterFrame));
  if (!spec.omitScan) {
    const scans = spec.scans ?? 1;
    for (let i = 0; i < scans; i++) {
      if (i > 0) parts.push(...renderSegments(spec.betweenScans));
      parts.push(scanSegment(components), spec.scanData ?? DEFAULT_SCAN_DATA);
    }
  }
  if (!spec.omitEoi) parts.push(Uint8Array.of(0xff, 0xd9));
  if (spec.trailing) parts.push(spec.trailing);
  return joinBytes(...parts);
}

// APP1 sa EXIF zaglavljem i GPS oznakom (sadržaj nije pravi TIFF, ali je prepoznatljiv u bajtovima)
export const EXIF_GPS_APP1: JpegSegment = { marker: 0xe1, data: 'Exif\0\0MM\0*GPSLatitude=44.8125;GPSLongitude=20.4612;Model=TestPhone' };
export const JFIF_APP0: JpegSegment = { marker: 0xe0, data: 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0' };
export const ICC_APP2: JpegSegment = { marker: 0xe2, data: 'ICC_PROFILE\0\x01\x01profil-boja' };
export const PHOTOSHOP_APP13: JpegSegment = { marker: 0xed, data: 'Photoshop 3.0\x008BIM-podaci' };
export const COMMENT: JpegSegment = { marker: 0xfe, data: 'komentar sa imenom klijenta' };

export function containsText(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, 'latin1'));
}
