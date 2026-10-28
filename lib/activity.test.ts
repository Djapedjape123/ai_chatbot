import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_LABELS,
  ACTIVITY_ACTIONS,
  MAX_PAGE,
  describeActivity,
  formatBelgrade,
  parseActivityQuery,
  type ActivityRow,
} from './activity.ts';

const DOC = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const DOC2 = 'a1b2c3d4-0000-4000-8000-000000000002';
const CHAT = '9c8b7a65-1111-4222-8333-444455556666';

const row = (action: string, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'r1',
  user_id: 'u1',
  actor_email: 'ana@kancelarija.rs',
  action,
  resource_type: null,
  resource_id: null,
  metadata: {},
  ip: null,
  created_at: '2026-10-28T12:05:00Z',
  ...extra,
});

const titles = new Map([[DOC, 'Zakon o radu']]);

test('ACTIVITY_ACTIONS: svaka akcija ima opis na srpskom', () => {
  assert.equal(ACTIVITY_ACTIONS.length, 8);
  for (const a of ACTIVITY_ACTIONS) assert.ok(ACTION_LABELS[a].length > 0, a);
});

test('formatBelgrade: beogradsko vreme, zimsko i letnje', () => {
  assert.equal(formatBelgrade('2026-10-28T12:05:00Z'), '28.10.2026. 13:05');
  assert.equal(formatBelgrade('2026-07-01T10:00:00Z'), '01.07.2026. 12:00');
});

test('formatBelgrade: neispravan datum daje crticu, ne izuzetak', () => {
  for (const bad of ['', 'juče', 'NaN']) assert.equal(formatBelgrade(bad), '—');
});

test('parseActivityQuery: bez parametara je prva strana bez filtera', () => {
  assert.deepEqual(parseActivityQuery({}), { page: 1, action: null });
});

test('parseActivityQuery: ispravna strana i akcija prolaze', () => {
  assert.deepEqual(parseActivityQuery({ page: '3', action: 'question_asked' }), { page: 3, action: 'question_asked' });
});

test('parseActivityQuery: neispravna strana pada na prvu, prevelika na najveću', () => {
  for (const bad of ['abc', '0', '-1', '1.5', '', ' 2', '2e1', ['2', '3'], undefined]) {
    assert.equal(parseActivityQuery({ page: bad }).page, 1, JSON.stringify(bad));
  }
  assert.equal(parseActivityQuery({ page: '99999999' }).page, MAX_PAGE);
});

test('parseActivityQuery: nepoznata akcija se ignoriše (nema filtera)', () => {
  for (const bad of ['drop table audit_log', 'QUESTION_ASKED', '', ['question_asked'], undefined]) {
    assert.equal(parseActivityQuery({ action: bad }).action, null, JSON.stringify(bad));
  }
});

test('describeActivity: pitanje navodi izvore (naslov ili ID) i ukupne tokene', () => {
  const d = describeActivity(
    row('question_asked', {
      resource_type: 'chat',
      resource_id: CHAT,
      metadata: { document_ids: [DOC, DOC2], sources: 5, input_tokens: 1200, output_tokens: 300, embed_tokens: 40 },
    }),
    titles
  );
  assert.equal(d.label, 'Postavljeno pitanje');
  assert.deepEqual(d.details, ['Razgovor: ID 9c8b7a65', 'Izvori: Zakon o radu, ID a1b2c3d4', 'Potrošeno tokena: 1540']);
});

test('describeActivity: pitanje bez izvora to kaže', () => {
  const d = describeActivity(row('question_asked', { metadata: { document_ids: [], sources: 0, input_tokens: 10, output_tokens: 5 } }), titles);
  assert.ok(d.details.includes('Bez izvora iz dokumenata'));
  assert.ok(d.details.includes('Potrošeno tokena: 15'));
});

test('describeActivity: pitanje iz vremena pre migracije (izvori postoje, ID-evi ne) ne tvrdi da izvora nije bilo', () => {
  const d = describeActivity(row('question_asked', { metadata: { document_ids: [], sources: 5, input_tokens: 10 } }), titles);
  assert.ok(!d.details.includes('Bez izvora iz dokumenata'));
  assert.ok(d.details.includes('Broj pasusa iz izvora: 5 (dokumenti nisu zabeleženi)'));
});

test('describeActivity: otpremanje dokumenta', () => {
  const d = describeActivity(
    row('document_uploaded', { resource_type: 'document', resource_id: DOC, metadata: { chunks: 12, size_bytes: 1572864, embed_tokens: 900, suspicious: true } }),
    titles
  );
  assert.equal(d.label, 'Dodat dokument');
  assert.deepEqual(d.details, ['Dokument: Zakon o radu', 'Pasusa: 12', 'Veličina: 1,5 MB', 'Sadržaj je bio označen kao sumnjiv']);
});

test('describeActivity: obrisan dokument nema naslov, pa se prikazuje ID', () => {
  const d = describeActivity(row('document_deleted', { resource_type: 'document', resource_id: DOC2 }), titles);
  assert.equal(d.label, 'Obrisan dokument');
  assert.deepEqual(d.details, ['Dokument: ID a1b2c3d4']);
});

test('describeActivity: blokirano otpremanje ima razlog na srpskom, bez internih oznaka', () => {
  const reasons = ['unreadable_pdf', 'no_text', 'too_many_chunks'];
  for (const reason of reasons) {
    const d = describeActivity(row('document_upload_blocked', { metadata: { reason, size_bytes: 2048 } }), titles);
    assert.equal(d.label, 'Blokirano otpremanje');
    assert.ok(!d.details.join(' ').includes(reason), reason);
    assert.ok(d.details.includes('Veličina: 2,0 KB'), reason);
  }
});

test('describeActivity: razgovor kreiran i obrisan', () => {
  assert.deepEqual(describeActivity(row('chat_created', { resource_type: 'chat', resource_id: CHAT }), titles), {
    label: 'Započet razgovor',
    details: ['Razgovor: ID 9c8b7a65'],
  });
  assert.deepEqual(describeActivity(row('chat_deleted', { resource_type: 'chat', resource_id: CHAT }), titles), {
    label: 'Obrisan razgovor',
    details: ['Razgovor: ID 9c8b7a65'],
  });
});

test('describeActivity: limit po vrsti i razlogu', () => {
  const detail = (kind: string, reason: string) => describeActivity(row('limit_reached', { metadata: { kind, reason } }), titles).details[0];
  assert.equal(detail('chat', 'daily_count'), 'Dnevni limit poruka');
  assert.equal(detail('ingest', 'daily_count'), 'Dnevni limit dokumenata');
  assert.equal(detail('chat', 'daily_tokens'), 'Dnevni budžet obrade');
  assert.equal(detail('ingest', 'monthly_tokens'), 'Mesečni budžet obrade');
});

test('describeActivity: sumnjiv sadržaj navodi opis obrazaca i da li je korisnik potvrdio', () => {
  const asked = describeActivity(row('suspicious_content_flagged', { metadata: { patterns: ['ignore_instructions', 'nepoznat'], acknowledged: false } }), titles);
  assert.equal(asked.label, 'Sumnjiv sadržaj u dokumentu');
  assert.deepEqual(asked.details, ['Pronađeno: poziv da se zanemare prethodna uputstva', 'Otpremanje nije potvrđeno']);
  const confirmed = describeActivity(row('suspicious_content_flagged', { metadata: { patterns: ['role_override'], acknowledged: true } }), titles);
  assert.equal(confirmed.details[1], 'Korisnik je potvrdio otpremanje');
});

test('describeActivity: nepoznata akcija i neispravan metadata ne ruše prikaz', () => {
  assert.deepEqual(describeActivity(row('nova_akcija'), titles), { label: 'nova_akcija', details: [] });
  for (const metadata of [null, 'tekst', 42, [], [1, 2], { document_ids: 'nije niz', input_tokens: 'x', patterns: 5 }]) {
    for (const a of ACTIVITY_ACTIONS) {
      const d = describeActivity(row(a, { metadata, resource_id: 'nije-uuid' }), titles);
      assert.equal(typeof d.label, 'string', `${a} ${JSON.stringify(metadata)}`);
      assert.ok(Array.isArray(d.details));
    }
  }
});
