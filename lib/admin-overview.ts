// Admin panel, pregled (2.5.5): čista logika nad redovima iz RPC funkcije admin_list_users().
// Bez server-only i Next uvoza, da bi se mogla testirati (npm test).

import { usageStatus, type LimitKey, type Limits } from './limits.ts';

export type AdminUser = {
  id: string;
  email: string;
  fullName: string | null;
  // null = nalog bez profila (vidljivo u panelu, vidi 2.5.1)
  role: string | null;
  createdAt: string;
  invitedAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  bannedUntil: string | null;
  hasMfa: boolean;
  documentsCount: number;
  chatsCount: number;
  dailyMessages: number;
  dailyDocuments: number;
  dailyTokens: number;
  monthlyTokens: number;
};

export type UserStatus = 'active' | 'invited' | 'blocked';

// Brojač iz baze: ceo broj >= 0. bigint kolone (tokeni) ume da stigne kao tekst.
function count(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function nullableDate(value: unknown): value is string | null {
  return value === null || validDate(value);
}

function parseRow(row: unknown): AdminUser | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id === '') return null;
  if (typeof r.email !== 'string') return null;
  if (r.full_name !== null && typeof r.full_name !== 'string') return null;
  if (r.role !== null && typeof r.role !== 'string') return null;
  if (typeof r.has_mfa !== 'boolean') return null;
  if (!validDate(r.created_at)) return null;
  if (!nullableDate(r.invited_at) || !nullableDate(r.email_confirmed_at)) return null;
  if (!nullableDate(r.last_sign_in_at) || !nullableDate(r.banned_until)) return null;

  const documentsCount = count(r.documents_count);
  const chatsCount = count(r.chats_count);
  const dailyMessages = count(r.daily_messages);
  const dailyDocuments = count(r.daily_documents);
  const dailyTokens = count(r.daily_tokens);
  const monthlyTokens = count(r.monthly_tokens);
  if (
    documentsCount === null ||
    chatsCount === null ||
    dailyMessages === null ||
    dailyDocuments === null ||
    dailyTokens === null ||
    monthlyTokens === null
  ) {
    return null;
  }

  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    createdAt: r.created_at,
    invitedAt: r.invited_at,
    emailConfirmedAt: r.email_confirmed_at,
    lastSignInAt: r.last_sign_in_at,
    bannedUntil: r.banned_until,
    hasMfa: r.has_mfa,
    documentsCount,
    chatsCount,
    dailyMessages,
    dailyDocuments,
    dailyTokens,
    monthlyTokens,
  };
}

// Odgovor admin_list_users(). Jedan neispravan red poništava ceo odgovor (null): zbirovi bi inače tiho
// izostavili nalog, a admin bi video manje korisnika ili manju potrošnju nego što stvarno postoji.
export function parseAdminUsers(data: unknown): AdminUser[] | null {
  if (!Array.isArray(data)) return null;
  const users: AdminUser[] = [];
  for (const row of data) {
    const user = parseRow(row);
    if (!user) return null;
    users.push(user);
  }
  return users;
}

// Blokada (ban) ima prednost; nalog koji nije potvrdio mejl još je „pozvan".
export function userStatus(user: Pick<AdminUser, 'bannedUntil' | 'emailConfirmedAt'>, now: Date): UserStatus {
  if (user.bannedUntil !== null && Date.parse(user.bannedUntil) > now.getTime()) return 'blocked';
  return user.emailConfirmedAt === null ? 'invited' : 'active';
}

export function displayName(user: Pick<AdminUser, 'fullName' | 'email'>): string {
  return user.fullName?.trim() || user.email;
}

// Tačka kao razdvajač hiljada (srpski). Ne koristi Intl, da rezultat ne zavisi od ICU podataka servera.
export function formatNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export type OfficeSummary = {
  total: number;
  active: number;
  invited: number;
  blocked: number;
  messagesToday: number;
  documentsToday: number;
  // Ukupno za kancelariju (i blokirani nalozi: potrošnja je potrošnja)
  tokensMonth: number;
  // Limiti važe PO ADVOKATU, pa se najveći pojedinačni potrošač poredi sa mesečnim budžetom, a ne zbir svih
  topMonthly: { name: string; tokens: number; percent: number } | null;
};

export function summarizeOffice(users: AdminUser[], limits: Limits, now: Date): OfficeSummary {
  const summary: OfficeSummary = {
    total: users.length,
    active: 0,
    invited: 0,
    blocked: 0,
    messagesToday: 0,
    documentsToday: 0,
    tokensMonth: 0,
    topMonthly: null,
  };

  let top: AdminUser | null = null;
  for (const user of users) {
    summary[userStatus(user, now)] += 1;
    summary.messagesToday += user.dailyMessages;
    summary.documentsToday += user.dailyDocuments;
    summary.tokensMonth += user.monthlyTokens;
    if (user.monthlyTokens > (top?.monthlyTokens ?? 0)) top = user;
  }
  if (top) {
    summary.topMonthly = {
      name: displayName(top),
      tokens: top.monthlyTokens,
      percent: Math.round((top.monthlyTokens / limits.monthlyTokens) * 100),
    };
  }
  return summary;
}

export type NearLimit = { id: string; name: string; percent: number; reason: string };

function reasonText(key: LimitKey, user: AdminUser, limits: Limits, percent: number): string {
  switch (key) {
    case 'daily_messages':
      return `Poruke danas: ${formatNumber(user.dailyMessages)} od ${formatNumber(limits.dailyMessages)}`;
    case 'daily_documents':
      return `Dokumenti danas: ${formatNumber(user.dailyDocuments)} od ${formatNumber(limits.dailyDocuments)}`;
    case 'daily_tokens':
      return `Dnevni budžet obrade: ${percent}%`;
    case 'monthly_tokens':
      return `Mesečni budžet obrade: ${percent}%`;
  }
}

// Advokati na 80% ili više bilo kog limita (isto pravilo kao upozorenje u aplikaciji), od najvećeg procenta.
// Blokirani nalozi se ne prijavljuju: ne mogu da troše.
export function nearLimit(users: AdminUser[], limits: Limits, now: Date): NearLimit[] {
  const hits: NearLimit[] = [];
  for (const user of users) {
    if (userStatus(user, now) === 'blocked') continue;
    const status = usageStatus(
      {
        daily_messages: user.dailyMessages,
        daily_documents: user.dailyDocuments,
        daily_tokens: user.dailyTokens,
        monthly_tokens: user.monthlyTokens,
      },
      limits,
    );
    if (!status.warning) continue;
    hits.push({
      id: user.id,
      name: displayName(user),
      percent: status.maxPercent,
      reason: reasonText(status.topKey, user, limits, status.maxPercent),
    });
  }
  return hits.sort((a, b) => b.percent - a.percent);
}
