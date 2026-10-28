import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRedirectPath } from './safe-redirect.ts';

test('safeRedirectPath: putanja na istom sajtu prolazi, sa upitom i hash-om', () => {
  assert.equal(safeRedirectPath('/reset-password'), '/reset-password');
  assert.equal(safeRedirectPath('/chat?id=5#kraj'), '/chat?id=5#kraj');
  assert.equal(safeRedirectPath('/'), '/');
});

test('safeRedirectPath: bez vrednosti vraća podrazumevanu putanju', () => {
  for (const empty of [null, undefined, '']) {
    assert.equal(safeRedirectPath(empty), '/');
  }
  assert.equal(safeRedirectPath(null, '/chat'), '/chat');
});

test('safeRedirectPath: ne počinje sa / (npr. @evil.com iz revizije 2.0) se odbija', () => {
  for (const bad of ['@evil.com', 'evil.com', 'https://evil.com', 'http://evil.com/x', 'javascript:alert(1)', 'chat']) {
    assert.equal(safeRedirectPath(bad), '/', bad);
  }
});

test('safeRedirectPath: // i /\\ otvaraju drugi sajt, pa se odbijaju', () => {
  for (const bad of ['//evil.com', '//evil.com/chat', '/\\evil.com', '/\\/evil.com', '///evil.com']) {
    assert.equal(safeRedirectPath(bad), '/', bad);
  }
});

test('safeRedirectPath: browser briše tab i novi red iz URL-a, pa /\\t/evil.com postaje //evil.com', () => {
  for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\u0000/evil.com', '/chat\n']) {
    assert.equal(safeRedirectPath(bad), '/', JSON.stringify(bad));
  }
});

test('safeRedirectPath: /.. normalizacija ne sme da napravi // na početku', () => {
  assert.equal(safeRedirectPath('/..//evil.com'), '/');
  assert.equal(safeRedirectPath('/a/../..//evil.com'), '/');
});

test('safeRedirectPath: procentno kodiran // ostaje obična putanja na našem sajtu', () => {
  assert.equal(safeRedirectPath('/%2F/evil.com'), '/%2F/evil.com');
});
