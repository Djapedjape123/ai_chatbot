import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINK_EXPIRED_PATH, parseConfirmParams, resolveConfirm } from './auth-confirm.ts';

const params = (query: string) => new URLSearchParams(query);

test('parseConfirmParams: poziv (invite) sa next=/set-password', () => {
  assert.deepEqual(parseConfirmParams(params('token_hash=abc123&type=invite&next=/set-password')), {
    type: 'invite',
    tokenHash: 'abc123',
    next: '/set-password',
  });
});

test('parseConfirmParams: reset lozinke (recovery) sa next=/reset-password', () => {
  assert.deepEqual(parseConfirmParams(params('token_hash=abc123&type=recovery&next=/reset-password')), {
    type: 'recovery',
    tokenHash: 'abc123',
    next: '/reset-password',
  });
});

test('parseConfirmParams: bez next odredište zavisi od vrste (poziv ne sme da završi u /chat bez lozinke)', () => {
  assert.equal(parseConfirmParams(params('token_hash=a&type=invite'))?.next, '/set-password');
  assert.equal(parseConfirmParams(params('token_hash=a&type=recovery'))?.next, '/reset-password');
});

test('parseConfirmParams: tuđa ili neispravna odredišta (open redirect) padaju na podrazumevano za vrstu', () => {
  for (const bad of ['//evil.com', '@evil.com', 'https://evil.com', '/\\evil.com', 'chat', '/..//evil.com']) {
    const q = new URLSearchParams({ token_hash: 'a', type: 'invite', next: bad });
    assert.equal(parseConfirmParams(q)?.next, '/set-password', bad);
  }
});

test('parseConfirmParams: ispravno odredište na ovom sajtu se poštuje', () => {
  assert.equal(parseConfirmParams(params('token_hash=a&type=recovery&next=/chat'))?.next, '/chat');
});

test('parseConfirmParams: dozvoljene su samo vrste invite i recovery', () => {
  for (const type of ['magiclink', 'signup', 'email', 'email_change', 'sms', 'INVITE', 'invite ', '']) {
    assert.equal(parseConfirmParams(new URLSearchParams({ token_hash: 'a', type })), null, `"${type}"`);
  }
  assert.equal(parseConfirmParams(params('token_hash=a')), null);
});

test('parseConfirmParams: token_hash je obavezan, neprazan i ograničene dužine', () => {
  assert.equal(parseConfirmParams(params('type=invite')), null);
  assert.equal(parseConfirmParams(params('token_hash=&type=invite')), null);
  assert.equal(parseConfirmParams(params('token_hash=%20%20&type=invite')), null);
  assert.equal(parseConfirmParams(new URLSearchParams({ token_hash: 'a'.repeat(513), type: 'invite' })), null);
  assert.notEqual(parseConfirmParams(new URLSearchParams({ token_hash: 'a'.repeat(512), type: 'invite' })), null);
});

test('resolveConfirm: uspeh šalje verify tačno {type, token_hash} i vraća odredište', async () => {
  const calls: unknown[] = [];
  const path = await resolveConfirm(params('token_hash=tok&type=invite&next=/set-password'), async (args) => {
    calls.push(args);
    return { error: null };
  });
  assert.equal(path, '/set-password');
  assert.deepEqual(calls, [{ type: 'invite', token_hash: 'tok' }]);
});

test('resolveConfirm: greška Auth-a (istekao ili iskorišćen link) vodi na stranicu o isteklom linku', async () => {
  const path = await resolveConfirm(params('token_hash=tok&type=recovery'), async () => ({
    error: { code: 'otp_expired', message: 'Token has expired or is invalid' },
  }));
  assert.equal(path, LINK_EXPIRED_PATH);
});

test('resolveConfirm: izuzetak (npr. nema mreže) se ne propušta, korisnik dobija istu stranicu', async () => {
  const path = await resolveConfirm(params('token_hash=tok&type=recovery'), async () => {
    throw new Error('fetch failed');
  });
  assert.equal(path, LINK_EXPIRED_PATH);
});

test('resolveConfirm: neispravni parametri ne pozivaju verify uopšte', async () => {
  let called = 0;
  const verify = async () => {
    called += 1;
    return { error: null };
  };
  for (const q of ['', 'token_hash=a&type=magiclink', 'type=invite', 'token_hash=a']) {
    assert.equal(await resolveConfirm(params(q), verify), LINK_EXPIRED_PATH, q);
  }
  assert.equal(called, 0);
});

test('LINK_EXPIRED_PATH je putanja na ovom sajtu', () => {
  assert.match(LINK_EXPIRED_PATH, /^\/[a-z-]+$/);
});
