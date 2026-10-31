import { z } from 'zod';
import { MAX_FILE_SIZE } from './ingest.ts';

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

// Limit veličine fajla je u lib/ingest.ts (deli ga i klijent)
export { MAX_FILE_SIZE };

// FormData za POST /api/ingest. Tip fajla (PDF ili Word) se NE proverava ovde: ime i MIME dolaze od korisnika,
// a zod ne čita sadržaj. Tip određuje ruta po magičnim bajtovima (lib/file-type.ts).
// acknowledge=true šalje korisnik koji je video upozorenje
// o sumnjivom sadržaju i ipak želi da nastavi (2.4).
// Isto polje za dokument i za prilog: obavezno, ne prazno, najviše 4MB
const uploadedFile = z
  .instanceof(File, { error: 'Niste poslali fajl.' })
  .refine((f) => f.size > 0, 'Fajl je prazan (0 bajtova).')
  .refine((f) => f.size <= MAX_FILE_SIZE, 'Fajl je prevelik. Maksimalna dozvoljena veličina je 4MB.');

export const ingestFormSchema = z.object(
  {
    file: uploadedFile,
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

// FormData za POST /api/attachments/docx (Word prilog uz pitanje, Faza 3). Samo fajl; tip određuje ruta po sadržaju.
export const attachmentFormSchema = z.object({ file: uploadedFile }, { error: invalidBody });

export function attachmentFormInput(formData: FormData) {
  return { file: formData.get('file') ?? undefined };
}

// --- Admin panel (2.5) ---

const emailMessage = 'Unesite ispravnu email adresu.';
const nameMessage = 'Unesite ime i prezime.';

// Kontrolni znaci, nevidljivi znaci za format (bidi, zero-width) i uglaste zagrade: ime ide u email pozivnice
// i u user_metadata, pa ne sme da nosi oznake ni znake koji lažiraju smer ispisa.
const FORBIDDEN_NAME_CHARS = /[\p{Cc}\p{Cf}<>]/u;

// Poziv advokata emailom (server action inviteLawyer).
export const inviteSchema = z.object(
  {
    email: z
      .string({ error: emailMessage })
      .trim()
      .toLowerCase()
      .max(254, emailMessage)
      .pipe(z.email({ error: emailMessage })),
    fullName: z
      .string({ error: nameMessage })
      .trim()
      .min(1, nameMessage)
      .max(100, 'Ime je predugačko (najviše 100 znakova).')
      .refine((v) => !FORBIDDEN_NAME_CHARS.test(v), 'Ime sadrži nedozvoljene znakove.'),
  },
  { error: invalidBody }
);

export function inviteFormInput(formData: FormData) {
  return { email: formData.get('email') ?? undefined, fullName: formData.get('fullName') ?? undefined };
}

export const roleSchema = z.enum(['admin', 'lawyer'], { error: 'Nepoznata uloga.' });

// Granice podešavanja kancelarije. Poruke i dokumenti su isti kao CHECK u bazi (office_settings), a gornja
// granica tokena (baza traži samo > 0) štiti od slučajno unetog preogromnog broja.
export const SETTINGS_BOUNDS = {
  dailyMessages: { min: 1, max: 10_000 },
  dailyDocuments: { min: 1, max: 1_000 },
  dailyTokens: { min: 1, max: 1_000_000_000_000 },
  monthlyTokens: { min: 1, max: 1_000_000_000_000 },
} as const;

// Polje iz forme stiže kao tekst: samo cifre (bez znaka, decimala i eksponenta), pa tek onda broj u granicama.
function settingField(label: string, bounds: { min: number; max: number }) {
  const notNumber = `${label}: unesite ceo broj.`;
  const outOfRange = `${label}: dozvoljeno je od ${bounds.min} do ${bounds.max}.`;
  return z
    .string({ error: notNumber })
    .trim()
    .regex(/^\d+$/, notNumber)
    .transform(Number)
    .pipe(z.number().min(bounds.min, outOfRange).max(bounds.max, outOfRange));
}

export const settingsSchema = z
  .object(
    {
      dailyMessages: settingField('Dnevni limit poruka', SETTINGS_BOUNDS.dailyMessages),
      dailyDocuments: settingField('Dnevni limit dokumenata', SETTINGS_BOUNDS.dailyDocuments),
      dailyTokens: settingField('Dnevni budžet obrade', SETTINGS_BOUNDS.dailyTokens),
      monthlyTokens: settingField('Mesečni budžet obrade', SETTINGS_BOUNDS.monthlyTokens),
    },
    { error: invalidBody }
  )
  .refine((v) => v.monthlyTokens >= v.dailyTokens, {
    message: 'Mesečni budžet ne može biti manji od dnevnog.',
    path: ['monthlyTokens'],
  });

export function settingsFormInput(formData: FormData) {
  return {
    dailyMessages: formData.get('dailyMessages') ?? undefined,
    dailyDocuments: formData.get('dailyDocuments') ?? undefined,
    dailyTokens: formData.get('dailyTokens') ?? undefined,
    monthlyTokens: formData.get('monthlyTokens') ?? undefined,
  };
}
