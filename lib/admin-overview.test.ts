import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayName,
  formatNumber,
  nearLimit,
  parseAdminUsers,
  summarizeOffice,
  userStatus,
  userUsage,
  type AdminUser,
} from './admin-overview.ts';
import { DEFAULT_LIMITS } from './limits.ts';

const NOW = new Date('2026-10-28T12:00:00Z');

// Red kakav vraća admin_list_users() (PostgREST: snake_case, bigint ume da stigne kao tekst)
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ana@kancelarija.rs',
    full_name: 'Ana Anić',
    role: 'lawyer',
    created_at: '2026-10-01T08:00:00Z',
    invited_at: '2026-10-01T07:59:00Z',
    email_confirmed_at: '2026-10-01T08:05:00Z',
    last_sign_in_at: '2026-10-28T09:00:00Z',
    banned_until: null,
    disabled_at: null,
    has_mfa: false,
    documents_count: 3,
    chats_count: 7,
    daily_messages: 10,
    daily_documents: 1,
    daily_tokens: 5000,
    monthly_tokens: 120000,
    ...overrides,
  };
}

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ana@kancelarija.rs',
    fullName: 'Ana Anić',
    role: 'lawyer',
    createdAt: '2026-10-01T08:00:00Z',
    invitedAt: null,
    emailConfirmedAt: '2026-10-01T08:05:00Z',
    lastSignInAt: null,
    bannedUntil: null,
    disabledAt: null,
    hasMfa: false,
    documentsCount: 0,
    chatsCount: 0,
    dailyMessages: 0,
    dailyDocuments: 0,
    dailyTokens: 0,
    monthlyTokens: 0,
    ...overrides,
  };
}

// --- parseAdminUsers ---

test('parseAdminUsers: red iz RPC-a se prevodi u camelCase', () => {
  const [u] = parseAdminUsers([rawRow()]) ?? [];
  assert.deepEqual(u, {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'ana@kancelarija.rs',
    fullName: 'Ana Anić',
    role: 'lawyer',
    createdAt: '2026-10-01T08:00:00Z',
    invitedAt: '2026-10-01T07:59:00Z',
    emailConfirmedAt: '2026-10-01T08:05:00Z',
    lastSignInAt: '2026-10-28T09:00:00Z',
    bannedUntil: null,
    disabledAt: null,
    hasMfa: false,
    documentsCount: 3,
    chatsCount: 7,
    dailyMessages: 10,
    dailyDocuments: 1,
    dailyTokens: 5000,
    monthlyTokens: 120000,
  });
});

test('parseAdminUsers: bigint koji stiže kao tekst postaje broj', () => {
  const [u] = parseAdminUsers([rawRow({ daily_tokens: '900000', monthly_tokens: '18000000' })]) ?? [];
  assert.equal(u.dailyTokens, 900000);
  assert.equal(u.monthlyTokens, 18000000);
});

test('parseAdminUsers: nalog bez profila (role i ime su null) je ispravan red', () => {
  const [u] = parseAdminUsers([rawRow({ role: null, full_name: null })]) ?? [];
  assert.equal(u.role, null);
  assert.equal(u.fullName, null);
});

test('parseAdminUsers: prazan spisak je ispravan', () => {
  assert.deepEqual(parseAdminUsers([]), []);
});

test('parseAdminUsers: sve što nije niz, ili ima i jedan neispravan red, daje null (brojke se ne smeju izmisliti)', () => {
  for (const bad of [null, undefined, 'tekst', 42, {}, { data: [] }]) {
    assert.equal(parseAdminUsers(bad), null, JSON.stringify(bad));
  }
  const badRows: Record<string, unknown>[] = [
    { id: null },
    { id: '' },
    { email: null },
    { has_mfa: 'da' },
    { daily_messages: -1 },
    { daily_messages: 1.5 },
    { daily_messages: '12abc' },
    { daily_tokens: null },
    { monthly_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { documents_count: undefined },
    { banned_until: 'nije datum' },
    { disabled_at: 'nije datum' },
    { disabled_at: 5 },
    { disabled_at: undefined },
    { created_at: null },
  ];
  for (const override of badRows) {
    assert.equal(parseAdminUsers([rawRow(), rawRow(override)]), null, JSON.stringify(override));
  }
  assert.equal(parseAdminUsers([rawRow(), 'red']), null);
  assert.equal(parseAdminUsers([rawRow(), null]), null);
});

// --- userStatus ---

test('userStatus: aktivan, pozvan (nije potvrdio mejl) i blokiran (ban još važi)', () => {
  assert.equal(userStatus(user(), NOW), 'active');
  assert.equal(userStatus(user({ emailConfirmedAt: null }), NOW), 'invited');
  assert.equal(userStatus(user({ bannedUntil: '2126-01-01T00:00:00Z' }), NOW), 'blocked');
});

test('userStatus: istekla blokada je aktivan nalog', () => {
  assert.equal(userStatus(user({ bannedUntil: '2026-10-28T11:59:59Z' }), NOW), 'active');
  assert.equal(userStatus(user({ bannedUntil: '2026-10-28T12:00:00Z' }), NOW), 'active');
  assert.equal(userStatus(user({ bannedUntil: '2026-10-28T12:00:01Z' }), NOW), 'blocked');
});

test('userStatus: blokada ima prednost nad pozivom', () => {
  assert.equal(userStatus(user({ emailConfirmedAt: null, bannedUntil: '2126-01-01T00:00:00Z' }), NOW), 'blocked');
});

test('parseAdminUsers: disabled_at iz baze postaje disabledAt', () => {
  const [u] = parseAdminUsers([rawRow({ disabled_at: '2026-10-20T08:00:00Z' })]) ?? [];
  assert.equal(u.disabledAt, '2026-10-20T08:00:00Z');
});

test('userStatus: oznaka blokade u profilu blokira nalog i bez Auth bana (pristupni token važi do isteka)', () => {
  assert.equal(userStatus(user({ disabledAt: '2026-10-20T08:00:00Z' }), NOW), 'blocked');
});

test('userStatus: oznaka blokade pobeđuje i istekao ban i neprihvaćen poziv', () => {
  assert.equal(userStatus(user({ disabledAt: '2026-10-20T08:00:00Z', bannedUntil: '2026-10-21T00:00:00Z' }), NOW), 'blocked');
  assert.equal(userStatus(user({ disabledAt: '2026-10-20T08:00:00Z', emailConfirmedAt: null }), NOW), 'blocked');
});

// --- userUsage ---

test('userUsage: procenat najopterećenijeg limita i njegov opis', () => {
  assert.deepEqual(userUsage(user({ dailyMessages: 10 }), DEFAULT_LIMITS), { percent: 10, reason: 'Poruke danas: 10 od 100' });
  assert.deepEqual(userUsage(user({ dailyMessages: 10, monthlyTokens: 18_000_000 }), DEFAULT_LIMITS), {
    percent: 90,
    reason: 'Mesečni budžet obrade: 90%',
  });
});

test('userUsage: bez potrošnje je 0%, a preko limita se procenat ne skraćuje', () => {
  assert.equal(userUsage(user(), DEFAULT_LIMITS).percent, 0);
  assert.equal(userUsage(user({ dailyMessages: 130 }), DEFAULT_LIMITS).percent, 130);
});

test('userUsage: koristi prosleđene limite', () => {
  assert.deepEqual(userUsage(user({ dailyDocuments: 3 }), { ...DEFAULT_LIMITS, dailyDocuments: 4 }), {
    percent: 75,
    reason: 'Dokumenti danas: 3 od 4',
  });
});

// --- displayName / formatNumber ---

test('displayName: ime, a bez imena (ili samo razmaci) email', () => {
  assert.equal(displayName(user()), 'Ana Anić');
  assert.equal(displayName(user({ fullName: null })), 'ana@kancelarija.rs');
  assert.equal(displayName(user({ fullName: '   ' })), 'ana@kancelarija.rs');
});

test('formatNumber: tačka kao razdvajač hiljada, kao u srpskom', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(1000), '1.000');
  assert.equal(formatNumber(20_000_000), '20.000.000');
  assert.equal(formatNumber(1234567), '1.234.567');
});

// --- summarizeOffice ---

test('summarizeOffice: broji naloge po stanju', () => {
  const users = [
    user({ id: 'a' }),
    user({ id: 'b' }),
    user({ id: 'c', emailConfirmedAt: null }),
    user({ id: 'd', bannedUntil: '2126-01-01T00:00:00Z' }),
  ];
  const s = summarizeOffice(users, DEFAULT_LIMITS, NOW);
  assert.equal(s.total, 4);
  assert.equal(s.active, 2);
  assert.equal(s.invited, 1);
  assert.equal(s.blocked, 1);
});

test('summarizeOffice: nalog blokiran oznakom u profilu se broji kao blokiran', () => {
  const s = summarizeOffice([user({ id: 'a' }), user({ id: 'b', disabledAt: '2026-10-20T08:00:00Z' })], DEFAULT_LIMITS, NOW);
  assert.equal(s.active, 1);
  assert.equal(s.blocked, 1);
});

test('summarizeOffice: zbirovi poruka, dokumenata i tokena, uključujući potrošnju blokiranog naloga', () => {
  const users = [
    user({ id: 'a', dailyMessages: 10, dailyDocuments: 1, monthlyTokens: 100 }),
    user({ id: 'b', dailyMessages: 5, dailyDocuments: 2, monthlyTokens: 250 }),
    user({ id: 'c', dailyMessages: 7, dailyDocuments: 0, monthlyTokens: 50, bannedUntil: '2126-01-01T00:00:00Z' }),
  ];
  const s = summarizeOffice(users, DEFAULT_LIMITS, NOW);
  assert.equal(s.messagesToday, 22);
  assert.equal(s.documentsToday, 3);
  assert.equal(s.tokensMonth, 400);
});

test('summarizeOffice: najveći potrošač meseca i njegov procenat od mesečnog budžeta po advokatu', () => {
  const users = [
    user({ id: 'a', monthlyTokens: 1_000_000 }),
    user({ id: 'b', fullName: null, email: 'bojan@kancelarija.rs', monthlyTokens: 5_000_000 }),
  ];
  const s = summarizeOffice(users, DEFAULT_LIMITS, NOW);
  assert.deepEqual(s.topMonthly, { name: 'bojan@kancelarija.rs', tokens: 5_000_000, percent: 25 });
});

test('summarizeOffice: bez ikakve potrošnje nema najvećeg potrošača, a prazna kancelarija je sve nula', () => {
  assert.equal(summarizeOffice([user()], DEFAULT_LIMITS, NOW).topMonthly, null);
  assert.deepEqual(summarizeOffice([], DEFAULT_LIMITS, NOW), {
    total: 0,
    active: 0,
    invited: 0,
    blocked: 0,
    messagesToday: 0,
    documentsToday: 0,
    tokensMonth: 0,
    topMonthly: null,
  });
});

// --- nearLimit ---

test('nearLimit: ispod 80% nema nikoga, tačno 80% ulazi', () => {
  assert.deepEqual(nearLimit([user({ dailyMessages: 79 })], DEFAULT_LIMITS, NOW), []);
  const [hit] = nearLimit([user({ dailyMessages: 80 })], DEFAULT_LIMITS, NOW);
  assert.equal(hit.percent, 80);
});

test('nearLimit: opis imenuje limit koji je najbliži prekoračenju', () => {
  const only = (overrides: Partial<AdminUser>) => nearLimit([user(overrides)], DEFAULT_LIMITS, NOW)[0].reason;
  assert.equal(only({ dailyMessages: 85 }), 'Poruke danas: 85 od 100');
  assert.equal(only({ dailyDocuments: 17 }), 'Dokumenti danas: 17 od 20');
  assert.equal(only({ dailyTokens: 900_000 }), 'Dnevni budžet obrade: 90%');
  assert.equal(only({ monthlyTokens: 18_000_000 }), 'Mesečni budžet obrade: 90%');
});

test('nearLimit: poredak je od najvećeg procenta, a preko 100% se ne skraćuje', () => {
  const hits = nearLimit(
    [
      user({ id: 'a', fullName: 'A', dailyMessages: 85 }),
      user({ id: 'b', fullName: 'B', dailyMessages: 130 }),
      user({ id: 'c', fullName: 'C', dailyMessages: 95 }),
    ],
    DEFAULT_LIMITS,
    NOW,
  );
  assert.deepEqual(
    hits.map((h) => [h.name, h.percent]),
    [
      ['B', 130],
      ['C', 95],
      ['A', 85],
    ],
  );
});

test('nearLimit: blokiran nalog ne troši, pa se ne prijavljuje; ostali podaci reda su tu', () => {
  const blocked = user({ id: 'x', dailyMessages: 99, bannedUntil: '2126-01-01T00:00:00Z' });
  assert.deepEqual(nearLimit([blocked], DEFAULT_LIMITS, NOW), []);
  const [hit] = nearLimit([user({ id: 'y', email: 'y@k.rs', fullName: null, dailyMessages: 90 })], DEFAULT_LIMITS, NOW);
  assert.equal(hit.id, 'y');
  assert.equal(hit.name, 'y@k.rs');
});

test('nearLimit: nalog blokiran oznakom u profilu se ne prijavljuje', () => {
  const blocked = user({ id: 'x', dailyMessages: 99, disabledAt: '2026-10-20T08:00:00Z' });
  assert.deepEqual(nearLimit([blocked], DEFAULT_LIMITS, NOW), []);
});

test('nearLimit: koristi prosleđene limite (ne podrazumevane)', () => {
  const strict = { ...DEFAULT_LIMITS, dailyMessages: 10 };
  const [hit] = nearLimit([user({ dailyMessages: 8 })], strict, NOW);
  assert.equal(hit.percent, 80);
  assert.equal(hit.reason, 'Poruke danas: 8 od 10');
});
