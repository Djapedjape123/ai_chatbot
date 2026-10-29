import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, belgradeDateOf, belgradeMidnightUtc, daysInclusive, isRealDate } from './belgrade-time.ts';

// Svi očekivani literali su izvedeni ručno, ne iz koda: Beograd je UTC+1 zimi (CET) i UTC+2 leti (CEST).
// Prelaz je poslednje nedelje marta (2026-03-29 u 01:00 UTC, 02:00 -> 03:00) i oktobra
// (2026-10-25 u 01:00 UTC, 03:00 -> 02:00). Ponoć je uvek pre prelaza istog dana, pa je
// ponoć 29.3. još CET, a ponoć 30.3. već CEST; ponoć 25.10. je još CEST, a ponoć 26.10. već CET.

test('belgradeMidnightUtc: zimi je ponoć u Beogradu 23:00 UTC prethodnog dana', () => {
  assert.equal(belgradeMidnightUtc('2026-01-01').toISOString(), '2025-12-31T23:00:00.000Z');
  assert.equal(belgradeMidnightUtc('2026-12-31').toISOString(), '2026-12-30T23:00:00.000Z');
});

test('belgradeMidnightUtc: leti je ponoć u Beogradu 22:00 UTC prethodnog dana', () => {
  assert.equal(belgradeMidnightUtc('2026-07-01').toISOString(), '2026-06-30T22:00:00.000Z');
});

test('belgradeMidnightUtc: proleće, prelaz na letnje vreme 29.3.2026.', () => {
  assert.equal(belgradeMidnightUtc('2026-03-28').toISOString(), '2026-03-27T23:00:00.000Z');
  assert.equal(belgradeMidnightUtc('2026-03-29').toISOString(), '2026-03-28T23:00:00.000Z');
  assert.equal(belgradeMidnightUtc('2026-03-30').toISOString(), '2026-03-29T22:00:00.000Z');
});

test('belgradeMidnightUtc: jesen, povratak na zimsko vreme 25.10.2026.', () => {
  assert.equal(belgradeMidnightUtc('2026-10-24').toISOString(), '2026-10-23T22:00:00.000Z');
  assert.equal(belgradeMidnightUtc('2026-10-25').toISOString(), '2026-10-24T22:00:00.000Z');
  assert.equal(belgradeMidnightUtc('2026-10-26').toISOString(), '2026-10-25T23:00:00.000Z');
});

test('belgradeMidnightUtc: dan prelaza traje 23 sata u martu i 25 sati u oktobru', () => {
  const hours = (from: string, to: string) => (belgradeMidnightUtc(to).getTime() - belgradeMidnightUtc(from).getTime()) / 3_600_000;
  assert.equal(hours('2026-03-29', '2026-03-30'), 23);
  assert.equal(hours('2026-10-25', '2026-10-26'), 25);
  assert.equal(hours('2026-06-10', '2026-06-11'), 24);
});

test('belgradeDateOf: datum je beogradski, ne UTC (zimi posle 23:00 UTC je već sledeći dan)', () => {
  assert.equal(belgradeDateOf(new Date('2026-10-29T22:30:00Z')), '2026-10-29'); // 23:30 CET
  assert.equal(belgradeDateOf(new Date('2026-10-29T23:00:00Z')), '2026-10-30'); // 00:00 CET
  assert.equal(belgradeDateOf(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
});

test('belgradeDateOf: leti je granica dana u 22:00 UTC', () => {
  assert.equal(belgradeDateOf(new Date('2026-06-30T21:59:59Z')), '2026-06-30'); // 23:59:59 CEST
  assert.equal(belgradeDateOf(new Date('2026-06-30T22:00:00Z')), '2026-07-01'); // 00:00 CEST
});

test('belgradeDateOf: na dane prelaza sata', () => {
  assert.equal(belgradeDateOf(new Date('2026-03-29T00:30:00Z')), '2026-03-29'); // 01:30 CET
  assert.equal(belgradeDateOf(new Date('2026-03-29T21:59:00Z')), '2026-03-29'); // 23:59 CEST
  assert.equal(belgradeDateOf(new Date('2026-03-29T22:00:00Z')), '2026-03-30'); // 00:00 CEST
  assert.equal(belgradeDateOf(new Date('2026-10-24T22:00:00Z')), '2026-10-25'); // 00:00 CEST
  assert.equal(belgradeDateOf(new Date('2026-10-25T22:59:00Z')), '2026-10-25'); // 23:59 CET
  assert.equal(belgradeDateOf(new Date('2026-10-25T23:00:00Z')), '2026-10-26'); // 00:00 CET
});

test('addDays: kalendarsko računanje bez zavisnosti od sata', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // prestupna godina
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-10-29', -6), '2026-10-23');
});

test('daysInclusive: broji kalendarske dane uključujući oba kraja, i preko prelaza sata', () => {
  assert.equal(daysInclusive('2026-10-29', '2026-10-29'), 1);
  assert.equal(daysInclusive('2026-10-23', '2026-10-29'), 7);
  assert.equal(daysInclusive('2026-03-28', '2026-03-30'), 3);
  assert.equal(daysInclusive('2026-10-24', '2026-10-26'), 3);
  assert.equal(daysInclusive('2026-08-01', '2026-10-29'), 90);
});

test('isRealDate: samo stvarni kalendarski datumi u obliku GGGG-MM-DD', () => {
  assert.equal(isRealDate('2026-10-29'), true);
  assert.equal(isRealDate('2028-02-29'), true);
  for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-1', '29.10.2026', '2026-10-29 ', '', '2026-10-29T00:00:00Z']) {
    assert.equal(isRealDate(bad), false, JSON.stringify(bad));
  }
});
