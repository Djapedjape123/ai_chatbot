import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditFilterParams,
  defaultAuditFilter,
  encodeCursor,
  keysetFilter,
  parseAuditFilter,
  parseCursor,
  searchParamsRecord,
  type AuditFilter,
} from './audit-filter.ts';

const NOW = new Date('2026-10-29T12:00:00Z'); // 13:00 u Beogradu, 29.10.2026.
const USER = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const CREATED = '2026-10-28T14:57:31.2116+00:00'; // oblik u kom PostgREST vraća created_at (mikrosekunde)

function ok(input: Record<string, string | string[] | undefined>, now = NOW): AuditFilter {
  const result = parseAuditFilter(input, now);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.filter;
}
function error(input: Record<string, string | string[] | undefined>, now = NOW): string {
  const result = parseAuditFilter(input, now);
  assert.ok(!result.ok, 'očekivana je greška');
  return result.ok ? '' : result.error;
}

test('podrazumevano: poslednjih 7 beogradskih dana zaključno sa danas, granice u UTC', () => {
  const f = ok({});
  assert.equal(f.toDate, '2026-10-29');
  assert.equal(f.fromDate, '2026-10-23');
  // 23.10. 00:00 CEST = 22.10. 22:00 UTC; kraj je ponoć posle 29.10. (CET) = 29.10. 23:00 UTC
  assert.equal(f.fromUtc, '2026-10-22T22:00:00.000Z');
  assert.equal(f.toUtcExclusive, '2026-10-29T23:00:00.000Z');
  assert.equal(f.userId, null);
  assert.equal(f.action, null);
  assert.equal(f.cursor, null);
});

test('"danas" je beogradski dan, ne UTC dan', () => {
  assert.equal(ok({}, new Date('2026-10-29T22:30:00Z')).toDate, '2026-10-29'); // 23:30 CET
  assert.equal(ok({}, new Date('2026-10-29T23:30:00Z')).toDate, '2026-10-30'); // 00:30 CET
  assert.equal(ok({}, new Date('2026-06-30T21:30:00Z')).toDate, '2026-06-30'); // 23:30 CEST
  assert.equal(ok({}, new Date('2026-06-30T22:30:00Z')).toDate, '2026-07-01'); // 00:30 CEST
});

test('izričit period preko prelaza na letnje vreme (29.3.2026.)', () => {
  const f = ok({ from: '2026-03-28', to: '2026-03-30' });
  assert.equal(f.fromUtc, '2026-03-27T23:00:00.000Z'); // 28.3. 00:00 CET
  assert.equal(f.toUtcExclusive, '2026-03-30T22:00:00.000Z'); // 31.3. 00:00 CEST
});

test('jedan dan koji ima 23 sata (29.3.) i jedan koji ima 25 sati (25.10.)', () => {
  const march = ok({ from: '2026-03-29', to: '2026-03-29' });
  assert.equal(march.fromUtc, '2026-03-28T23:00:00.000Z');
  assert.equal(march.toUtcExclusive, '2026-03-29T22:00:00.000Z');
  assert.equal(Date.parse(march.toUtcExclusive) - Date.parse(march.fromUtc), 23 * 3_600_000);

  const october = ok({ from: '2026-10-25', to: '2026-10-25' });
  assert.equal(october.fromUtc, '2026-10-24T22:00:00.000Z');
  assert.equal(october.toUtcExclusive, '2026-10-25T23:00:00.000Z');
  assert.equal(Date.parse(october.toUtcExclusive) - Date.parse(october.fromUtc), 25 * 3_600_000);
});

test('najviše 90 kalendarskih dana zaključno', () => {
  assert.equal(ok({ from: '2026-08-01', to: '2026-10-29' }).fromDate, '2026-08-01'); // tačno 90
  assert.match(error({ from: '2026-07-31', to: '2026-10-29' }), /90/); // 91
});

test('90 dana se broji u kalendarskim danima, a ne u satima (period preko povratka na zimsko vreme traje 90 dana i 1 sat)', () => {
  const f = ok({ from: '2026-07-31', to: '2026-10-28' });
  assert.equal(Date.parse(f.toUtcExclusive) - Date.parse(f.fromUtc), 90 * 24 * 3_600_000 + 3_600_000);
});

test('početak posle kraja je greška', () => {
  assert.match(error({ from: '2026-10-20', to: '2026-10-19' }), /početak|pre/i);
});

test('datum mora biti stvaran kalendarski datum u obliku GGGG-MM-DD', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '29.10.2026', '2026-1-1', ' 2026-10-01', '2026-10-01T00:00:00Z', 'danas']) {
    assert.match(error({ from: bad, to: '2026-10-29' }), /datum/i, `from=${bad}`);
    assert.match(error({ from: '2026-10-01', to: bad }), /datum/i, `to=${bad}`);
  }
});

test('prazna polja iz forme se tumače kao da nisu poslata', () => {
  const f = ok({ user: '', action: '', from: '', to: '', cursor: '' });
  assert.deepEqual(f, ok({}));
});

test('samo početak: kraj je danas; samo kraj: početak je 6 dana pre njega', () => {
  const onlyFrom = ok({ from: '2026-10-20' });
  assert.equal(onlyFrom.toDate, '2026-10-29');
  assert.equal(onlyFrom.fromDate, '2026-10-20');
  const onlyTo = ok({ to: '2026-10-10' });
  assert.equal(onlyTo.fromDate, '2026-10-04');
  assert.equal(onlyTo.toDate, '2026-10-10');
});

test('samo početak stariji od 90 dana je greška (period bi bio predugačak)', () => {
  assert.match(error({ from: '2026-06-01' }), /90/);
});

test('advokat: ispravan UUID prolazi, sve ostalo je greška (i ponovljen parametar)', () => {
  assert.equal(ok({ user: USER }).userId, USER);
  assert.match(error({ user: 'nije-uuid' }), /advokat/i);
  assert.match(error({ user: [USER, USER] }), /advokat/i);
  assert.match(error({ user: `${USER},id.eq.x` }), /advokat/i);
});

test('akcija: samo poznate vrste', () => {
  assert.equal(ok({ action: 'question_asked' }).action, 'question_asked');
  assert.equal(ok({ action: 'audit_exported' }).action, 'audit_exported');
  for (const bad of ['nepoznato', 'constructor', '__proto__', 'question_asked,id.eq.x', 'QUESTION_ASKED']) {
    assert.match(error({ action: bad }), /vrst/i, bad);
  }
});

test('kursor: created_at i id odvojeni donjom crtom; vrednost se čuva tačno (mikrosekunde)', () => {
  const f = ok({ cursor: `${CREATED}_${USER}` });
  assert.deepEqual(f.cursor, { createdAt: CREATED, id: USER });
  assert.deepEqual(parseCursor(`2026-10-28T14:57:31Z_${USER}`), { createdAt: '2026-10-28T14:57:31Z', id: USER });
});

test('kursor ulazi u PostgREST filter, pa mora biti strogo proveren (nema zareza, zagrada, navodnika)', () => {
  const evil = [
    `${CREATED}",id.eq.${USER}_${USER}`,
    `2026-10-28T14:57:31Z),id.neq.${USER}_${USER}`,
    `2026-10-28_${USER}`,
    `${CREATED}_nije-uuid`,
    `${CREATED}_${USER}_${USER}`,
    `${CREATED}`,
    `_${USER}`,
    `${CREATED} _${USER}`,
    `${CREATED}_${USER}\n`,
    `2026-10-28T14:57:31.1234567+00:00_${USER}`, // 7 cifara: Postgres ima mikrosekunde (6)
  ];
  for (const raw of evil) {
    assert.equal(parseCursor(raw), null, JSON.stringify(raw));
    assert.match(error({ cursor: raw }), /strana|kursor/i, JSON.stringify(raw));
  }
});

test('encodeCursor i parseCursor su međusobno inverzni', () => {
  const cursor = { createdAt: CREATED, id: USER };
  assert.deepEqual(parseCursor(encodeCursor(cursor)), cursor);
});

test('keysetFilter: vreme ide pod dvostrukim navodnicima (":" je rezervisan znak u PostgREST filterima)', () => {
  assert.equal(
    keysetFilter({ createdAt: CREATED, id: USER }),
    `created_at.lt."${CREATED}",and(created_at.eq."${CREATED}",id.lt.${USER})`,
  );
});

test('auditFilterParams: izričiti period i filteri u fiksnom redosledu, bez kursora i bez praznih polja', () => {
  const f = ok({ user: USER, action: 'question_asked', cursor: `${CREATED}_${USER}` });
  assert.equal(auditFilterParams(f).toString(), `user=${USER}&action=question_asked&from=2026-10-23&to=2026-10-29`);
  assert.equal(auditFilterParams(ok({})).toString(), 'from=2026-10-23&to=2026-10-29');
});

test('keysetFilter: odbija kursor koji nije prošao proveru oblika (ne gradi filter od proizvoljnog teksta)', () => {
  assert.throws(() => keysetFilter({ createdAt: 'x"),id.eq.1', id: USER }), /kursor/i);
  assert.throws(() => keysetFilter({ createdAt: CREATED, id: `${USER}),id.neq.x` }), /kursor/i);
  assert.throws(() => keysetFilter({ createdAt: '', id: '' }), /kursor/i);
});

test('searchParamsRecord: ponovljen parametar postaje niz (šema ga odbija), a __proto__ je običan ključ bez uticaja na prototip', () => {
  const record = searchParamsRecord(new URLSearchParams('user=a&user=b&from=2026-10-01&__proto__=x'));
  assert.deepEqual(record.user, ['a', 'b']);
  assert.equal(record.from, '2026-10-01');
  assert.equal(Object.getPrototypeOf(record), null);
  assert.equal(record['__proto__'], 'x');
  assert.match(error(searchParamsRecord(new URLSearchParams(`user=${USER}&user=${USER}`))), /advokat/i);
});

test('defaultAuditFilter: isto što i prazan filter, bez mogućnosti greške (za formu kad je unos neispravan)', () => {
  assert.deepEqual(defaultAuditFilter(NOW), ok({}));
  assert.equal(defaultAuditFilter(NOW).fromDate, '2026-10-23');
});
