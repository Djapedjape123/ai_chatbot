import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMfaCode, qrImageSrc } from './mfa-code.ts';

test('normalizeMfaCode: šest cifara prolazi', () => {
  assert.equal(normalizeMfaCode('123456'), '123456');
  assert.equal(normalizeMfaCode('000000'), '000000');
});

test('normalizeMfaCode: aplikacije prikazuju "123 456", pa se razmaci, crtice i prelomi uklanjaju', () => {
  assert.equal(normalizeMfaCode('123 456'), '123456');
  assert.equal(normalizeMfaCode('  123 456  '), '123456');
  assert.equal(normalizeMfaCode('123-456'), '123456');
  assert.equal(normalizeMfaCode('123456\n'), '123456');
  assert.equal(normalizeMfaCode('123 456'), '123456'); // nedeljivi razmak pri kopiranju
});

test('normalizeMfaCode: sve što nije tačno 6 ASCII cifara daje null', () => {
  for (const bad of [
    '', ' ', '12345', '1234567', '12345a', 'abcdef', '12 34 5', '123,456', '+123456', '1e5555',
    '１２３４５６', // cifre punog formata
    '١٢٣٤٥٦', // arapsko-indijske cifre
  ]) {
    assert.equal(normalizeMfaCode(bad), null, JSON.stringify(bad));
  }
});

test('normalizeMfaCode: ne-string daje null', () => {
  for (const bad of [null, undefined, 123456, {}, ['123456'], true]) {
    assert.equal(normalizeMfaCode(bad), null, JSON.stringify(bad) ?? 'undefined');
  }
});

test('qrImageSrc: Supabase vraća SVG sa prefiksom, a # i < u njemu se kodiraju da ih browser ne prekine', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000000" width="5"/></svg>';
  const src = qrImageSrc(`data:image/svg+xml;utf-8,${svg}`);
  assert.ok(src);
  assert.ok(src.startsWith('data:image/svg+xml;utf8,'));
  assert.ok(!src.includes('#'), 'sirovi # bi prekinuo data URL');
  assert.ok(!src.includes('<'));
  assert.equal(decodeURIComponent(src.slice('data:image/svg+xml;utf8,'.length)), svg);
});

test('qrImageSrc: sve što nije SVG data URL koji očekujemo daje null (nikad se ne prosleđuje u <img>)', () => {
  for (const bad of [
    '', 'javascript:alert(1)', 'https://evil.example/qr.svg', 'data:text/html,<script>alert(1)</script>',
    'data:image/png;base64,AAAA', ' data:image/svg+xml;utf-8,<svg/>', 'DATA:image/svg+xml;utf-8,<svg/>',
    null, undefined, 5, {},
  ]) {
    assert.equal(qrImageSrc(bad), null, JSON.stringify(bad) ?? 'undefined');
  }
});
