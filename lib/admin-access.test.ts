import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideMfaStep, isAdminRole } from './admin-access.ts';

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
