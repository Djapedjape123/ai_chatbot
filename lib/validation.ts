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
