import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAccountAccess } from './account-access.ts';

const NOW = new Date('2026-10-29T12:00:00Z');
const FUTURE = '2126-01-01T00:00:00Z';
const PAST = '2026-10-29T11:59:59Z';

function decide(overrides: Partial<Parameters<typeof decideAccountAccess>[0]> = {}) {
  return decideAccountAccess({ bannedUntil: null, profile: { disabled_at: null }, profileFailed: false, now: NOW, ...overrides });
}

test('decideAccountAccess: nalog bez blokade prolazi', () => {
  assert.equal(decide(), 'ok');
  assert.equal(decide({ bannedUntil: undefined }), 'ok');
});

test('decideAccountAccess: nalog bez reda u profilu prolazi (stariji nalozi rade i danas)', () => {
  assert.equal(decide({ profile: null }), 'ok');
  assert.equal(decide({ profile: undefined }), 'ok');
});

test('decideAccountAccess: oznaka blokade u profilu blokira i kad Auth ne zna za ban (token još važi)', () => {
  assert.equal(decide({ profile: { disabled_at: '2026-10-20T08:00:00Z' } }), 'blocked');
});

test('decideAccountAccess: ban koji još važi blokira i bez oznake u profilu', () => {
  assert.equal(decide({ bannedUntil: FUTURE }), 'blocked');
});

test('decideAccountAccess: istekao ban ne blokira, a granica je strogo "posle sada"', () => {
  assert.equal(decide({ bannedUntil: PAST }), 'ok');
  assert.equal(decide({ bannedUntil: NOW.toISOString() }), 'ok');
  assert.equal(decide({ bannedUntil: '2026-10-29T12:00:01Z' }), 'blocked');
});

test('decideAccountAccess: greška pri čitanju profila ne propušta zahtev', () => {
  assert.equal(decide({ profile: null, profileFailed: true }), 'check_failed');
});

test('decideAccountAccess: blokada ima prednost nad greškom provere', () => {
  assert.equal(decide({ bannedUntil: FUTURE, profileFailed: true }), 'blocked');
});

test('decideAccountAccess: nerazumljiva vrednost blokade znači blokiran (zatvoreno pravilo)', () => {
  assert.equal(decide({ bannedUntil: 'nije datum' }), 'blocked');
  assert.equal(decide({ bannedUntil: 5 }), 'blocked');
  assert.equal(decide({ profile: { disabled_at: true } }), 'blocked');
  assert.equal(decide({ profile: { disabled_at: 'nije datum' } }), 'blocked');
});
