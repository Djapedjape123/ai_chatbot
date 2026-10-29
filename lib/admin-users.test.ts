import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_LIMIT,
  checkInviteQuota,
  describeAdminRpcError,
  describeInviteError,
  guardBlock,
  guardRoleChange,
  inviteWindowStart,
  parseAdminUserDetail,
  roleLabel,
  statusLabel,
} from './admin-users.ts';

const ID = '11111111-1111-4111-8111-111111111111';

// Red kakav vraća admin_get_user(): kolone admin_list_users() plus dokumenti i razgovori kao jsonb nizovi
function rawDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    email: 'ana@kancelarija.rs',
    full_name: 'Ana Anić',
    role: 'lawyer',
    created_at: '2026-10-01T08:00:00Z',
    invited_at: '2026-10-01T07:59:00Z',
    email_confirmed_at: '2026-10-01T08:05:00Z',
    last_sign_in_at: '2026-10-28T09:00:00Z',
    banned_until: null,
    disabled_at: null,
    has_mfa: true,
    documents_count: 2,
    chats_count: 1,
    daily_messages: 10,
    daily_documents: 1,
    daily_tokens: 5000,
    monthly_tokens: 120000,
    documents: [
      { id: 'd1', title: 'Ugovor o zakupu.pdf', created_at: '2026-10-10T10:00:00Z', chunk_count: 12 },
      { id: 'd2', title: 'Tužba.pdf', created_at: '2026-10-09T10:00:00Z', chunk_count: 30 },
    ],
    chats: [{ id: 'c1', title: 'Rok za žalbu u parničnom postupku', created_at: '2026-10-11T10:00:00Z', message_count: 4 }],
    ...overrides,
  };
}

// --- parseAdminUserDetail ---

test('parseAdminUserDetail: nalog, dokumenti i razgovori se prevode u camelCase', () => {
  const result = parseAdminUserDetail([rawDetail()]);
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.detail.user.id, ID);
  assert.equal(result.detail.user.email, 'ana@kancelarija.rs');
  assert.equal(result.detail.user.hasMfa, true);
  assert.deepEqual(result.detail.documents, [
    { id: 'd1', title: 'Ugovor o zakupu.pdf', createdAt: '2026-10-10T10:00:00Z', chunkCount: 12 },
    { id: 'd2', title: 'Tužba.pdf', createdAt: '2026-10-09T10:00:00Z', chunkCount: 30 },
  ]);
  assert.deepEqual(result.detail.chats, [
    { id: 'c1', title: 'Rok za žalbu u parničnom postupku', createdAt: '2026-10-11T10:00:00Z', messageCount: 4 },
  ]);
});

test('parseAdminUserDetail: sadržaj se nikad ne prenosi, čak ni ako ga baza vrati (admin vidi nazive i datume)', () => {
  const result = parseAdminUserDetail([
    rawDetail({
      documents: [{ id: 'd1', title: 'Ugovor.pdf', created_at: '2026-10-10T10:00:00Z', chunk_count: 1, content: 'POVERLJIV PASUS' }],
      chats: [{ id: 'c1', title: 'Pitanje', created_at: '2026-10-11T10:00:00Z', message_count: 1, content: 'POVERLJIVA PORUKA' }],
    }),
  ]);
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.deepEqual(Object.keys(result.detail.documents[0]).sort(), ['chunkCount', 'createdAt', 'id', 'title']);
  assert.deepEqual(Object.keys(result.detail.chats[0]).sort(), ['createdAt', 'id', 'messageCount', 'title']);
  assert.ok(!JSON.stringify(result).includes('POVERLJIV'));
});

test('parseAdminUserDetail: naslov razgovora ili dokumenta može biti null, a prazni nizovi su ispravni', () => {
  const nulls = parseAdminUserDetail([
    rawDetail({
      documents: [{ id: 'd1', title: null, created_at: '2026-10-10T10:00:00Z', chunk_count: 0 }],
      chats: [{ id: 'c1', title: null, created_at: '2026-10-11T10:00:00Z', message_count: 0 }],
    }),
  ]);
  assert.equal(nulls.kind === 'ok' && nulls.detail.documents[0].title, null);
  assert.equal(nulls.kind === 'ok' && nulls.detail.chats[0].title, null);

  const empty = parseAdminUserDetail([rawDetail({ documents: [], chats: [] })]);
  assert.equal(empty.kind === 'ok' && empty.detail.documents.length, 0);
  assert.equal(empty.kind === 'ok' && empty.detail.chats.length, 0);
});

test('parseAdminUserDetail: nalog koji ne postoji (prazan odgovor) razlikuje se od neispravnog odgovora', () => {
  assert.deepEqual(parseAdminUserDetail([]), { kind: 'not_found' });
  for (const bad of [null, undefined, 'tekst', 42, {}, [rawDetail(), rawDetail()]]) {
    assert.deepEqual(parseAdminUserDetail(bad), { kind: 'invalid' }, JSON.stringify(bad));
  }
});

test('parseAdminUserDetail: neispravan nalog, dokument ili razgovor poništava ceo odgovor', () => {
  const bad: Record<string, unknown>[] = [
    { email: null },
    { disabled_at: undefined },
    { documents: null },
    { documents: 'nije niz' },
    { chats: {} },
    { documents: [null] },
    { documents: [{ id: '', title: 'x', created_at: '2026-10-10T10:00:00Z', chunk_count: 1 }] },
    { documents: [{ id: 'd1', title: 5, created_at: '2026-10-10T10:00:00Z', chunk_count: 1 }] },
    { documents: [{ id: 'd1', title: 'x', created_at: 'sutra', chunk_count: 1 }] },
    { documents: [{ id: 'd1', title: 'x', created_at: '2026-10-10T10:00:00Z', chunk_count: -1 }] },
    { documents: [{ id: 'd1', title: 'x', created_at: '2026-10-10T10:00:00Z' }] },
    { chats: [{ id: 'c1', title: 'x', created_at: '2026-10-11T10:00:00Z', message_count: 1.5 }] },
    { chats: [{ id: 'c1', title: 'x', created_at: '2026-10-11T10:00:00Z' }] },
  ];
  for (const override of bad) {
    assert.deepEqual(parseAdminUserDetail([rawDetail(override)]), { kind: 'invalid' }, JSON.stringify(override));
  }
});

// --- oznake ---

test('statusLabel i roleLabel: srpski nazivi, a nalog bez profila je vidljiv', () => {
  assert.equal(statusLabel('active'), 'Aktivan');
  assert.equal(statusLabel('invited'), 'Pozvan');
  assert.equal(statusLabel('blocked'), 'Blokiran');
  assert.equal(roleLabel('admin'), 'Admin');
  assert.equal(roleLabel('lawyer'), 'Advokat');
  assert.equal(roleLabel(null), 'Bez profila');
  assert.equal(roleLabel('nepoznata'), 'Bez profila');
});

// --- zaštite radnji ---

test('guardBlock: admin ne blokira sebe, a drugog može', () => {
  assert.equal(guardBlock(ID, ID), 'Ne možete blokirati sopstveni nalog.');
  assert.equal(guardBlock(ID, '22222222-2222-4222-8222-222222222222'), null);
});

test('guardRoleChange: admin ne menja sopstvenu ulogu, tuđu može', () => {
  assert.equal(guardRoleChange(ID, ID), 'Ne možete menjati sopstvenu ulogu.');
  assert.equal(guardRoleChange(ID, '22222222-2222-4222-8222-222222222222'), null);
});

// --- kvota poziva ---

test('checkInviteQuota: dvadeseti poziv prolazi, dvadeset prvi ne', () => {
  assert.equal(INVITE_LIMIT, 20);
  assert.deepEqual(checkInviteQuota(0), { ok: true });
  assert.deepEqual(checkInviteQuota(19), { ok: true });
  assert.deepEqual(checkInviteQuota(20), {
    ok: false,
    error: 'Poslato je 20 poziva u poslednja 24 sata. Pokušajte ponovo kasnije.',
  });
  assert.equal(checkInviteQuota(35).ok, false);
});

test('checkInviteQuota: nepoznat broj poslatih poziva ne otvara slanje (zatvoreno pravilo)', () => {
  for (const bad of [NaN, -1, 1.5, Infinity, null, undefined, '3']) {
    assert.equal(checkInviteQuota(bad as number).ok, false, String(bad));
  }
});

test('inviteWindowStart: poslednja 24 sata, bez računanja vremenskih zona', () => {
  assert.equal(inviteWindowStart(new Date('2026-10-29T12:00:00Z')).toISOString(), '2026-10-28T12:00:00.000Z');
  assert.equal(inviteWindowStart(new Date('2026-03-29T00:30:00Z')).toISOString(), '2026-03-28T00:30:00.000Z');
});

// --- poruke grešaka ---

test('describeInviteError: poznati kodovi Auth-a imaju srpsku poruku', () => {
  assert.equal(describeInviteError({ code: 'email_exists' }), 'Nalog sa tom email adresom već postoji.');
  assert.equal(describeInviteError({ code: 'user_already_exists' }), 'Nalog sa tom email adresom već postoji.');
  const rate = 'Previše poziva u kratkom roku. Pokušajte ponovo za nekoliko minuta.';
  assert.equal(describeInviteError({ code: 'over_email_send_rate_limit' }), rate);
  assert.equal(describeInviteError({ code: 'over_request_rate_limit' }), rate);
  assert.equal(describeInviteError({ code: 'email_address_invalid' }), 'Email adresa nije prihvaćena.');
  assert.match(describeInviteError({ code: 'email_address_not_authorized' }) ?? '', /SMTP/);
});

test('describeInviteError: nepoznata greška ne propušta interni tekst Auth-a', () => {
  const generic = 'Slanje poziva nije uspelo. Pokušajte ponovo.';
  assert.equal(describeInviteError({ code: 'unexpected_failure', message: 'connection to 10.0.0.5 refused' }), generic);
  assert.equal(describeInviteError({ message: 'tajna' }), generic);
  assert.equal(describeInviteError(null), generic);
  assert.equal(describeInviteError(undefined), generic);
});

test('describeAdminRpcError: kodovi admin funkcija iz baze imaju srpsku poruku', () => {
  assert.equal(describeAdminRpcError({ code: '42501' }), 'Nemate dozvolu za ovu radnju.');
  assert.equal(describeAdminRpcError({ code: '22023' }), 'Neispravan zahtev.');
  assert.equal(describeAdminRpcError({ code: 'P0002' }), 'Nalog nije pronađen.');
  assert.equal(describeAdminRpcError({ code: '23514' }), 'Kancelarija mora imati bar jednog aktivnog admina.');
});

test('describeAdminRpcError: nepoznata greška ne propušta interni tekst baze', () => {
  const generic = 'Radnja nije uspela. Pokušajte ponovo.';
  assert.equal(describeAdminRpcError({ code: '57014', message: 'canceling statement due to statement timeout' }), generic);
  assert.equal(describeAdminRpcError({}), generic);
  assert.equal(describeAdminRpcError(null), generic);
});
