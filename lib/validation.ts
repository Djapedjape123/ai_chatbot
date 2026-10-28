import { z } from 'zod';

// Limit na dužinu pojedinačnog upita
export const MAX_QUERY_LENGTH = 4000;

// guid = bilo koji 8-4-4-4-12 hex niz (kao i Postgres uuid), bez provere verzije/varijante
export const uuidSchema = z.guid();

const invalidBody = 'Neispravan zahtev.';
const missingQuery = 'Pitanje nije poslato.';

// Telo POST /api/chat. Nepoznata polja se odbacuju (zod ih podrazumevano uklanja).
export const chatRequestSchema = z.object(
  {
    query: z
      .string({ error: missingQuery })
      .trim()
      .min(1, missingQuery)
      .max(MAX_QUERY_LENGTH, `Pitanje je predugačko. Maksimalna dozvoljena dužina je ${MAX_QUERY_LENGTH} karaktera.`),
    // Frontend za novi razgovor šalje null
    chatId: uuidSchema.nullish().transform((v) => v ?? undefined),
  },
  { error: invalidBody }
);

// Vercel prima najviše ~4.5MB tela zahteva, pa je stvarni limit 4MB (ne 10MB kao u staroj poruci)
export const MAX_FILE_SIZE = 4 * 1024 * 1024;

// FormData za POST /api/ingest. acknowledge=true šalje korisnik koji je video upozorenje
// o sumnjivom sadržaju i ipak želi da nastavi (2.4).
export const ingestFormSchema = z.object(
  {
    file: z
      .instanceof(File, { error: 'Niste poslali PDF fajl.' })
      .refine((f) => f.size > 0, 'Fajl je prazan (0 bajtova).')
      .refine((f) => f.size <= MAX_FILE_SIZE, 'Fajl je prevelik. Maksimalna dozvoljena veličina je 4MB.')
      .refine(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
        'Dozvoljen je isključivo PDF format fajla.'
      ),
    acknowledge: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  },
  { error: invalidBody }
);

export function ingestFormInput(formData: FormData) {
  return { file: formData.get('file') ?? undefined, acknowledge: formData.get('acknowledge') ?? undefined };
}
