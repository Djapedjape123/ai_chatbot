import { z } from 'zod';
import { MAX_FILE_SIZE } from './ingest.ts';
import {
  IMAGES_MAX_TOTAL_BYTES,
  IMAGE_MAX_BYTES,
  MAX_DOCUMENT_PAGES,
  MAX_IMAGES_PER_QUESTION,
  TRANSCRIPT_MAX_LENGTH,
} from './image-limits.ts';

// Limit na dužinu pojedinačnog upita
export const MAX_QUERY_LENGTH = 4000;

// guid = bilo koji 8-4-4-4-12 hex niz (kao i Postgres uuid), bez provere verzije/varijante
export const uuidSchema = z.guid();

const invalidBody = 'Neispravan zahtev.';
const missingQuery = 'Pitanje nije poslato.';

// Telo POST /api/chat. Nepoznata polja se odbacuju (zod ih podrazumevano uklanja).
const querySchema = z
  .string({ error: missingQuery })
  .trim()
  .min(1, missingQuery)
  .max(MAX_QUERY_LENGTH, `Pitanje je predugačko. Maksimalna dozvoljena dužina je ${MAX_QUERY_LENGTH} karaktera.`);

// Frontend za novi razgovor šalje null (JSON), odnosno ne šalje polje (FormData)
const optionalChatIdSchema = uuidSchema.nullish().transform((v) => v ?? undefined);

export const chatRequestSchema = z.object(
  {
    query: querySchema,
    chatId: optionalChatIdSchema,
  },
  { error: invalidBody }
);

// FormData za POST /api/chat sa slikama (Faza 3.5). Ovde se proveravaju broj i veličina; da je slika zaista
// ispravan JPEG proverava ruta po sadržaju (lib/image-inspect.ts).
const imageFile = z
  .instanceof(File, { error: 'Slika nije poslata kao fajl.' })
  .refine((f) => f.size > 0, 'Slika je prazna (0 bajtova).')
  .refine((f) => f.size <= IMAGE_MAX_BYTES, `Slika je prevelika. Najviše je ${IMAGE_MAX_BYTES / 1024}KB po slici.`);

export const chatImagesFormSchema = z.object(
  {
    query: querySchema,
    chatId: optionalChatIdSchema,
    images: z
      .array(imageFile)
      .min(1, 'Niste poslali sliku.')
      .max(MAX_IMAGES_PER_QUESTION, `Najviše ${MAX_IMAGES_PER_QUESTION} slika uz jedno pitanje.`)
      .refine((list) => list.reduce((sum, f) => sum + f.size, 0) <= IMAGES_MAX_TOTAL_BYTES, 'Slike su zajedno prevelike.'),
  },
  { error: invalidBody }
);

// FormData za POST /api/ingest/transcribe: jedna strana slikanog dokumenta (Faza 3.5)
export const transcribeFormSchema = z.object({ image: imageFile }, { error: invalidBody });

export function transcribeFormInput(formData: FormData) {
  return { image: formData.get('image') ?? undefined };
}

// Telo POST /api/ingest/text: prepis koji je advokat pregledao (i možda ispravio) pre indeksiranja.
// Tekst je ulaz kao i PDF koji advokat sam napravi: prolazi iste provere (pasusi, detekcija, ledger).
export const transcriptIngestSchema = z.object(
  {
    title: z.string({ error: 'Unesite naziv dokumenta.' }).trim().min(1, 'Unesite naziv dokumenta.').max(200, 'Naziv je predugačak (najviše 200 znakova).'),
    text: z
      .string({ error: 'Prepis nije poslat.' })
      .trim()
      .min(1, 'Prepis je prazan.')
      .max(TRANSCRIPT_MAX_LENGTH, `Prepis je predugačak. Najviše je ${TRANSCRIPT_MAX_LENGTH} znakova.`),
    pages: z.number({ error: invalidBody }).int(invalidBody).min(1, invalidBody).max(MAX_DOCUMENT_PAGES, `Najviše ${MAX_DOCUMENT_PAGES} strana u jednom dokumentu.`),
    acknowledge: z.boolean().optional().default(false),
  },
  { error: invalidBody }
);

export function chatImagesFormInput(formData: FormData) {
  return {
    query: formData.get('query') ?? undefined,
    chatId: formData.get('chatId') ?? undefined,
    images: formData.getAll('images'),
  };
}

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
