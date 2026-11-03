// Granice za slike sa telefona (Faza 3.5). Bez server-only importa: koriste ih i server (provera) i pregledač
// (smanjenje pre slanja), pa se brojevi ne mogu razići.

// Uz jedno pitanje i u jednom slikanom dokumentu za bazu znanja
export const MAX_IMAGES_PER_QUESTION = 5;
export const MAX_DOCUMENT_PAGES = 5;

// Server: jedna slika najviše 800KB, sve slike u zahtevu najviše 4MB (Vercel prima najviše 4,5MB po zahtevu)
export const IMAGE_MAX_BYTES = 800 * 1024;
export const IMAGES_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

// Server: najduža stranica slike (u pikselima)
export const IMAGE_MIN_LONG_EDGE = 200;
export const IMAGE_MAX_LONG_EDGE = 2000;

// Pregledač: cilj smanjenja (1568px je granica posle koje Claude ionako smanjuje sliku)
export const CLIENT_TARGET_LONG_EDGE = 1568;
export const CLIENT_TARGET_BYTES = 700 * 1024;

// Prepis slikanog dokumenta koji advokat šalje na indeksiranje (5 strana gustog teksta)
export const TRANSCRIPT_MAX_LENGTH = 40_000;
