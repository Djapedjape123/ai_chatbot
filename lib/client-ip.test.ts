import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp } from './client-ip.ts';

const VERCEL = { VERCEL: '1' };

test('getClientIp: van Vercel-a ne veruje x-forwarded-for (klijent ga može podmetnuti)', () => {
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4' }), {}), null);
});

test('getClientIp: na Vercel-u uzima prvu adresu', () => {
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), VERCEL), '1.2.3.4');
  assert.equal(getClientIp(new Headers({ 'x-forwarded-for': '2001:db8::1' }), VERCEL), '2001:db8::1');
});

test('getClientIp: neispravna ili prazna vrednost daje null (kolona ip je inet)', () => {
  for (const bad of ['', 'abc', "1.2.3.4'; drop table x", '999.1.1.1']) {
    assert.equal(getClientIp(new Headers({ 'x-forwarded-for': bad }), VERCEL), null, bad);
  }
  assert.equal(getClientIp(new Headers(), VERCEL), null);
});
