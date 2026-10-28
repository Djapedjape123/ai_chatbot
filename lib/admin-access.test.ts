import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminMfaRedirect, decideMfaStep, isAdminRole } from './admin-access.ts';

test('adminMfaRedirect: aal2 ne preusmerava nigde', () => {
  assert.equal(adminMfaRedirect('ok', '/admin'), null);
});

test('adminMfaRedirect: ima faktor, nema koda: unos koda, uz povratak u panel', () => {
  assert.equal(adminMfaRedirect('challenge', '/admin'), '/login/mfa?next=%2Fadmin');
});

test('adminMfaRedirect: nema faktor: prvo se uključuje dvostepena prijava, uz povratak u panel', () => {
  assert.equal(adminMfaRedirect('enroll', '/admin'), '/account/security?next=%2Fadmin');
});

test('adminMfaRedirect: odredište se kodira, pa upit ne može da doda tuđe parametre', () => {
  const to = adminMfaRedirect('challenge', '/admin/users?x=1&next=//evil.com') ?? '';
  const url = new URL(to, 'http://localhost');
  assert.equal(url.pathname, '/login/mfa');
  assert.deepEqual([...url.searchParams.keys()], ['next']);
  assert.equal(url.searchParams.get('next'), '/admin/users?x=1&next=//evil.com');
});

test('decideMfaStep: aal2 je jedini nivo koji otvara panel', () => {
  assert.equal(decideMfaStep('aal2', 'aal2'), 'ok');
});

test('decideMfaStep: prijavljen sa lozinkom, a ima potvrđen faktor: traži se kod', () => {
  assert.equal(decideMfaStep('aal1', 'aal2'), 'challenge');
});

test('decideMfaStep: prijavljen sa lozinkom, a nema faktor: prvo se uključuje dvostepena prijava', () => {
  assert.equal(decideMfaStep('aal1', 'aal1'), 'enroll');
});

test('decideMfaStep: nepoznata ili nedostajuća vrednost nikad ne otvara panel', () => {
  for (const bad of [undefined, null, '', 'aal3', 'AAL2', 2, {}, ['aal2']]) {
    assert.notEqual(decideMfaStep(bad, 'aal2'), 'ok', `current=${JSON.stringify(bad)}`);
    assert.notEqual(decideMfaStep(bad, bad), 'ok', `oba=${JSON.stringify(bad)}`);
  }
  assert.equal(decideMfaStep('aal1', undefined), 'enroll');
});

test('isAdminRole: samo tačno "admin"', () => {
  assert.equal(isAdminRole('admin'), true);
  for (const bad of ['lawyer', '', 'ADMIN', 'admin ', ' admin', null, undefined, 1, true, {}, ['admin']]) {
    assert.equal(isAdminRole(bad), false, JSON.stringify(bad));
  }
});
