import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  describePasswordUpdateError,
  validateNewPassword,
} from './password-policy.ts';

test('politika: najmanje 12 znakova, najviše 72 bajta', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  assert.equal(MAX_PASSWORD_BYTES, 72);
});

test('validateNewPassword: 12 znakova prolazi, 11 ne prolazi', () => {
  const ok = 'a'.repeat(12);
  const short = 'a'.repeat(11);
  assert.equal(validateNewPassword(ok, ok), null);
  assert.match(validateNewPassword(short, short) ?? '', /12/);
});

test('validateNewPassword: znaci se broje kao znaci, ne kao UTF-16 jedinice (šest emotikona nije 12 znakova)', () => {
  const emoji = '😀'.repeat(6);
  assert.equal(emoji.length, 12);
  assert.match(validateNewPassword(emoji, emoji) ?? '', /12/);
  // dvanaest slova sa kvačicama je 12 znakova
  const letters = 'č'.repeat(12);
  assert.equal(validateNewPassword(letters, letters), null);
});

test('validateNewPassword: prazna polja', () => {
  assert.equal(validateNewPassword('', ''), 'Popunite oba polja.');
  assert.equal(validateNewPassword('a'.repeat(12), ''), 'Popunite oba polja.');
  assert.equal(validateNewPassword('', 'a'.repeat(12)), 'Popunite oba polja.');
});

test('validateNewPassword: lozinke se moraju poklapati (i velika/mala slova su bitna)', () => {
  assert.equal(validateNewPassword('a'.repeat(12), 'a'.repeat(11) + 'b'), 'Lozinke se ne poklapaju.');
  assert.equal(validateNewPassword('A'.repeat(12), 'a'.repeat(12)), 'Lozinke se ne poklapaju.');
});

test('validateNewPassword: lozinka samo od razmaka ne prolazi, iako ima 12 znakova', () => {
  const blanks = ' '.repeat(12);
  assert.match(validateNewPassword(blanks, blanks) ?? '', /razmak/i);
});

test('validateNewPassword: razmak unutar lozinke je dozvoljen (fraza)', () => {
  const phrase = 'zeleno nebo plavo';
  assert.equal(validateNewPassword(phrase, phrase), null);
});

test('validateNewPassword: gornja granica je 72 bajta (bcrypt), a ne 72 znaka', () => {
  const edge = 'a'.repeat(72);
  assert.equal(validateNewPassword(edge, edge), null);
  const over = 'a'.repeat(73);
  assert.match(validateNewPassword(over, over) ?? '', /72/);
  // 40 slova sa kvačicama je 40 znakova, ali 80 bajtova
  const bytesOver = 'č'.repeat(40);
  assert.match(validateNewPassword(bytesOver, bytesOver) ?? '', /72/);
});

test('describePasswordUpdateError: slaba ili procurela lozinka', () => {
  assert.match(describePasswordUpdateError({ code: 'weak_password' }), /slaba|procurel/i);
});

test('describePasswordUpdateError: ista lozinka kao stara', () => {
  assert.match(describePasswordUpdateError({ code: 'same_password' }), /razlikuje/i);
});

test('describePasswordUpdateError: potreban je kod iz aplikacije (insufficient_aal)', () => {
  assert.match(describePasswordUpdateError({ code: 'insufficient_aal' }), /kod/i);
});

test('describePasswordUpdateError: tražena svežija prijava (reauthentication_needed) nije MFA, pa poruka ne pominje kod iz aplikacije', () => {
  const message = describePasswordUpdateError({ code: 'reauthentication_needed' });
  assert.match(message, /prijav/i);
  assert.doesNotMatch(message, /aplikacij|kod/i);
});

test('describePasswordUpdateError: sesija ne postoji ili je link istekao', () => {
  for (const code of ['session_not_found', 'otp_expired']) {
    assert.match(describePasswordUpdateError({ code }), /istekao|iskorišćen/i, code);
  }
});

test('describePasswordUpdateError: nepoznata greška ili bilo šta što nije greška daje opštu poruku, bez internog teksta', () => {
  const generic = describePasswordUpdateError({ code: 'nesto_novo', message: 'duplicate key value violates unique constraint "x"' });
  assert.match(generic, /nije uspela|greška/i);
  assert.doesNotMatch(generic, /duplicate|constraint/);
  for (const bad of [null, undefined, 'tekst', 42, {}, { code: 7 }]) {
    assert.equal(describePasswordUpdateError(bad), generic);
  }
});
