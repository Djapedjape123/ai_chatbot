// Admin panel, advokati (2.5.6): čista logika za pregled jednog advokata i za radnje nad nalozima.
// Bez server-only i Next uvoza, da bi se mogla testirati (npm test).

import { parseAdminUserRow, parseCount, type AdminUser, type UserStatus } from './admin-overview.ts';

export type AdminUserDocument = { id: string; title: string | null; createdAt: string; chunkCount: number };
export type AdminUserChat = { id: string; title: string | null; createdAt: string; messageCount: number };
export type AdminUserDetail = { user: AdminUser; documents: AdminUserDocument[]; chats: AdminUserChat[] };

export type DetailResult = { kind: 'ok'; detail: AdminUserDetail } | { kind: 'not_found' } | { kind: 'invalid' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isTitle = (v: unknown): v is string | null => v === null || typeof v === 'string';

// Nazivi i datumi, nikad sadržaj (odluka 4 iz plana): iz svakog elementa se prenose samo poznata polja,
// pa i kad bi baza jednom vratila više, sadržaj ne bi stigao do stranice.
function parseDocuments(value: unknown): AdminUserDocument[] | null {
  if (!Array.isArray(value)) return null;
  const out: AdminUserDocument[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const chunkCount = parseCount(item.chunk_count);
    if (typeof item.id !== 'string' || item.id === '' || !isTitle(item.title) || !isDate(item.created_at) || chunkCount === null) {
      return null;
    }
    out.push({ id: item.id, title: item.title, createdAt: item.created_at, chunkCount });
  }
  return out;
}

function parseChats(value: unknown): AdminUserChat[] | null {
  if (!Array.isArray(value)) return null;
  const out: AdminUserChat[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const messageCount = parseCount(item.message_count);
    if (typeof item.id !== 'string' || item.id === '' || !isTitle(item.title) || !isDate(item.created_at) || messageCount === null) {
      return null;
    }
    out.push({ id: item.id, title: item.title, createdAt: item.created_at, messageCount });
  }
  return out;
}

// Odgovor admin_get_user(): niz sa jednim redom, a za nepostojeći nalog prazan niz. Svaki drugi oblik je
// neispravan, a neispravan element poništava ceo odgovor (stranica ne sme da prikaže "polovičan" nalog).
export function parseAdminUserDetail(data: unknown): DetailResult {
  if (!Array.isArray(data)) return { kind: 'invalid' };
  if (data.length === 0) return { kind: 'not_found' };
  if (data.length > 1) return { kind: 'invalid' };

  const row: unknown = data[0];
  const user = parseAdminUserRow(row);
  if (!user || !isRecord(row)) return { kind: 'invalid' };
  const documents = parseDocuments(row.documents);
  const chats = parseChats(row.chats);
  if (!documents || !chats) return { kind: 'invalid' };
  return { kind: 'ok', detail: { user, documents, chats } };
}

export function statusLabel(status: UserStatus): string {
  switch (status) {
    case 'active':
      return 'Aktivan';
    case 'invited':
      return 'Pozvan';
    case 'blocked':
      return 'Blokiran';
  }
}

// Nalog bez profila (null) ili nepoznata vrednost: ostaje vidljivo u panelu, a ne tiho "advokat"
export function roleLabel(role: string | null): string {
  if (role === 'admin') return 'Admin';
  if (role === 'lawyer') return 'Advokat';
  return 'Bez profila';
}

// Zaštite radnji nad nalozima. Baza ih ponavlja (blokada sopstvenog naloga, poslednji aktivni admin),
// ovo je prva linija: razumljiva poruka pre poziva i bez nepotrebnog saobraćaja ka Auth-u.
export function guardBlock(actorId: string, targetId: string): string | null {
  return actorId === targetId ? 'Ne možete blokirati sopstveni nalog.' : null;
}

export function guardRoleChange(actorId: string, targetId: string): string | null {
  return actorId === targetId ? 'Ne možete menjati sopstvenu ulogu.' : null;
}

// Najviše 20 poziva (i ponovnih slanja) u poslednja 24 sata po kancelariji: ako admin nalog bude kompromitovan,
// šteta od slanja mejlova ostaje mala. Klizni prozor umesto kalendarskog dana, da ne bi trebalo računati
// vremenske zone (granica ponoći se ne može iskoristiti za dvostruko slanje).
export const INVITE_LIMIT = 20;
const INVITE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function inviteWindowStart(now: Date): Date {
  return new Date(now.getTime() - INVITE_WINDOW_MS);
}

export function checkInviteQuota(sentInWindow: unknown): { ok: true } | { ok: false; error: string } {
  // Nepoznat broj (greška upita) ne sme da otvori slanje
  if (typeof sentInWindow !== 'number' || !Number.isInteger(sentInWindow) || sentInWindow < 0) {
    return { ok: false, error: 'Provera ograničenja poziva nije uspela. Pokušajte ponovo.' };
  }
  if (sentInWindow >= INVITE_LIMIT) {
    return { ok: false, error: `Poslato je ${INVITE_LIMIT} poziva u poslednja 24 sata. Pokušajte ponovo kasnije.` };
  }
  return { ok: true };
}

const GENERIC_INVITE_ERROR = 'Slanje poziva nije uspelo. Pokušajte ponovo.';
const RATE_LIMIT_ERROR = 'Previše poziva u kratkom roku. Pokušajte ponovo za nekoliko minuta.';

// Kodovi grešaka Supabase Auth-a (spisak u Supabase dokumentaciji). Interni tekst greške se nikad ne prikazuje.
export function describeInviteError(error: { code?: unknown; message?: unknown } | null | undefined): string {
  switch (error?.code) {
    case 'email_exists':
    case 'user_already_exists':
      return 'Nalog sa tom email adresom već postoji.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return RATE_LIMIT_ERROR;
    case 'email_address_invalid':
      return 'Email adresa nije prihvaćena.';
    case 'email_address_not_authorized':
      return 'Slanje mejla na ovu adresu nije dozvoljeno dok Supabase koristi podrazumevani SMTP. Podesite sopstveni SMTP.';
    default:
      return GENERIC_INVITE_ERROR;
  }
}

// Kodovi koje bacaju admin_* funkcije u bazi (supabase/migrations/20261028150000 i 20261029100000).
export function describeAdminRpcError(error: { code?: unknown; message?: unknown } | null | undefined): string {
  switch (error?.code) {
    case '42501':
      return 'Nemate dozvolu za ovu radnju.';
    case '22023':
      return 'Neispravan zahtev.';
    case 'P0002':
      return 'Nalog nije pronađen.';
    case '23514':
      return 'Kancelarija mora imati bar jednog aktivnog admina.';
    default:
      return 'Radnja nije uspela. Pokušajte ponovo.';
  }
}

// Rezultati server akcija (app/admin/actions.ts). Ovde, a ne u 'use server' fajlu, da ih koriste i klijentske komponente.
export type ActionResult = { success: true; message: string } | { error: string };

// Stanje forme za poziv. Pri grešci se vraćaju uneta polja: React posle akcije prazni neuređena polja,
// a admin ne treba da ponovo kuca adresu zbog, na primer, ograničenja slanja.
export type InviteState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; error: string; values: { email: string; fullName: string } };
