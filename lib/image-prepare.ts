// Priprema slike u pregledaču pre slanja (Faza 3.5): smanjenje na najdužu stranicu 1568px i ponovno kodiranje
// u JPEG kroz canvas. Canvas ne prenosi metapodatke, pa ovo uklanja EXIF i GPS još na telefonu (server ih uklanja
// ponovo, lib/image-inspect.ts). Ujedno pretvara HEIC sa iPhone-a u JPEG, jer ga Safari ume da dekodira.
// Čisti delovi (targetSize, encodeWithinLimit) se testiraju bez pregledača.
import { CLIENT_TARGET_BYTES, CLIENT_TARGET_LONG_EDGE, IMAGE_MIN_LONG_EDGE } from './image-limits.ts';

// Od boljeg ka slabijem kvalitetu; tekst ostaje čitljiv i na najnižem
export const JPEG_QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

export function targetSize(width: number, height: number, maxLongEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function encodeWithinLimit(
  encode: (quality: number) => Promise<Blob | null>,
  maxBytes: number
): Promise<Blob | null> {
  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await encode(quality);
    if (blob && blob.size <= maxBytes) return blob;
  }
  return null;
}

export type PreparedImage = { blob: Blob; width: number; height: number; previewUrl: string };

export class ImagePrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePrepareError';
  }
}

// Samo u pregledaču. Poruke su na srpskom i idu direktno korisniku.
export async function prepareImage(file: File): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    // 'from-image' poštuje orijentaciju iz EXIF-a (uspravna slika ne ostaje položena)
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImagePrepareError('Ovaj format slike ne može da se otvori. Slikajte dokument ponovo kamerom telefona.');
  }

  try {
    if (Math.max(bitmap.width, bitmap.height) < IMAGE_MIN_LONG_EDGE) {
      throw new ImagePrepareError('Slika je premala da bi se tekst pročitao. Slikajte dokument izbliza.');
    }
    const { width, height } = targetSize(bitmap.width, bitmap.height, CLIENT_TARGET_LONG_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImagePrepareError('Pregledač ne može da obradi sliku. Pokušajte ponovo.');
    // Beo papir ispod providnih delova (PNG snimak ekrana), da JPEG ne dobije crnu pozadinu
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await encodeWithinLimit(
      (quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality)),
      CLIENT_TARGET_BYTES
    );
    if (!blob || blob.type !== 'image/jpeg') {
      throw new ImagePrepareError('Slika je prevelika i posle smanjenja. Slikajte samo stranu dokumenta, bez okoline.');
    }
    return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}
