import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicPath } from './route-access.ts';

test('isPublicPath: stranice koje odjavljen korisnik sme da otvori', () => {
  for (const pathname of [
    '/',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/auth/callback',
    '/auth/confirm',
    '/link-expired',
  ]) {
    assert.equal(isPublicPath(pathname), true, pathname);
  }
});

test('isPublicPath: završna kosa crta ne menja odluku', () => {
  assert.equal(isPublicPath('/auth/confirm/'), true);
  assert.equal(isPublicPath('/login/'), true);
});

test('isPublicPath: stranice za prijavljene nisu javne (poziv i postavljanje lozinke traže sesiju)', () => {
  for (const pathname of [
    '/set-password',
    '/chat',
    '/documents',
    '/activity',
    '/admin',
    '/admin/users',
    '/account/security',
    '/login/mfa',
    '/api/chat',
  ]) {
    assert.equal(isPublicPath(pathname), false, pathname);
  }
});

test('isPublicPath: javna registracija je ukinuta, /register više nije javna stranica', () => {
  assert.equal(isPublicPath('/register'), false);
});

test('isPublicPath: sličan prefiks nije izuzetak', () => {
  for (const pathname of ['/auth', '/auth/', '/auth/confirmx', '/auth/confirm/x', '/auth/callbackx', '/link-expired-x', '/login-x', '/authx/confirm']) {
    assert.equal(isPublicPath(pathname), false, pathname);
  }
});
