import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countVerifiedFactors, decideMfaGate, isMfaPending, mfaNextPath, readAal } from './mfa-gate.ts';

// Lažan JWT: samo payload se čita (potpis proverava Auth server pozivom getUser()).
function jwt(payload: unknown): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'ES256', typ: 'JWT' })}.${part(payload)}.potpis`;
}

test('readAal: čita nivo iz access tokena', () => {
  assert.equal(readAal(jwt({ aal: 'aal2' })), 'aal2');
  assert.equal(readAal(jwt({ aal: 'aal1' })), 'aal1');
});

test('readAal: base64url znakovi (- i _) i payload bez padding-a se čitaju ispravno', () => {
  // "???" daje "_" a ">>>" daje "-" u base64url
  const token = jwt({ aal: 'aal2', x: '???>>>', y: '???>>>???' });
  assert.match(token.split('.')[1], /[-_]/);
  assert.equal(readAal(token), 'aal2');
});

test('readAal: nedostajući ili nepoznat nivo daje null (nikad aal2)', () => {
  for (const aal of [undefined, null, '', 'aal3', 'AAL2', 'aal2 ', 2, true, {}, ['aal2']]) {
    assert.equal(readAal(jwt({ aal })), null, JSON.stringify(aal));
  }
  assert.equal(readAal(jwt({})), null);
});

test('readAal: neispravan token daje null i ne baca grešku', () => {
  const notObject = (value: unknown) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(value)).toString('base64url')}.x`;
  for (const bad of [
    undefined, null, 42, {}, [], '', 'abc', 'a.b', 'a.b.c.d', '..', 'a.!!!.c', 'a.@@@@.c',
    `a.${Buffer.from('nije json').toString('base64url')}.c`,
    notObject('aal2'), notObject(null), notObject(['aal2']), notObject(7),
  ]) {
    assert.equal(readAal(bad), null, JSON.stringify(bad));
  }
});

test('countVerifiedFactors: broji samo potvrđene faktore', () => {
  assert.equal(countVerifiedFactors([{ status: 'verified' }, { status: 'unverified' }, { status: 'verified' }]), 2);
  assert.equal(countVerifiedFactors([{ status: 'unverified' }]), 0);
  assert.equal(countVerifiedFactors([]), 0);
});

test('countVerifiedFactors: nepoznat oblik ne računa se kao potvrđen faktor', () => {
  for (const bad of [undefined, null, 'verified', 5, {}, { status: 'verified' }]) {
    assert.equal(countVerifiedFactors(bad), 0, JSON.stringify(bad));
  }
  assert.equal(countVerifiedFactors([null, 'verified', 7, {}, { status: 'VERIFIED' }, { status: ' verified' }, { status: 1 }]), 0);
});

test('isMfaPending: bez potvrđenog faktora MFA nije obavezan ni na kom nivou', () => {
  for (const aal of ['aal1', 'aal2', null, undefined, 'aal3']) {
    assert.equal(isMfaPending({ verifiedFactors: 0, aal }), false, String(aal));
  }
});

test('isMfaPending: sa potvrđenim faktorom samo aal2 otvara pristup', () => {
  assert.equal(isMfaPending({ verifiedFactors: 1, aal: 'aal2' }), false);
  assert.equal(isMfaPending({ verifiedFactors: 3, aal: 'aal2' }), false);
});

test('isMfaPending: sa potvrđenim faktorom sve ostalo (aal1, nepoznato, nedostaje) traži kod', () => {
  for (const aal of ['aal1', null, undefined, '', 'aal3', 'AAL2', 2, {}]) {
    assert.equal(isMfaPending({ verifiedFactors: 1, aal }), true, JSON.stringify(aal) ?? 'undefined');
  }
});

const pending = { verifiedFactors: 1, aal: 'aal1' } as const;

test('decideMfaGate: nalog bez potvrđenog faktora prolazi svuda, i na /admin', () => {
  for (const pathname of ['/chat', '/documents', '/admin', '/admin/users', '/api/chat', '/login/mfa']) {
    for (const method of ['GET', 'POST']) {
      assert.deepEqual(decideMfaGate({ pathname, method, verifiedFactors: 0, aal: 'aal1' }), { kind: 'allow' }, `${method} ${pathname}`);
    }
  }
});

test('decideMfaGate: nalog sa kodom (aal2) prolazi svuda', () => {
  for (const pathname of ['/chat', '/admin', '/api/chat', '/account/security']) {
    assert.deepEqual(decideMfaGate({ pathname, method: 'GET', verifiedFactors: 1, aal: 'aal2' }), { kind: 'allow' }, pathname);
  }
});

test('decideMfaGate: stranica bez koda vodi na /login/mfa i pamti odakle je korisnik došao', () => {
  assert.deepEqual(decideMfaGate({ ...pending, pathname: '/chat', method: 'GET' }), { kind: 'redirect', to: '/login/mfa?next=%2Fchat' });
  assert.deepEqual(decideMfaGate({ ...pending, pathname: '/admin/users/abc', method: 'GET' }), {
    kind: 'redirect',
    to: '/login/mfa?next=%2Fadmin%2Fusers%2Fabc',
  });
  for (const pathname of ['/documents', '/activity', '/account/security', '/admin', '/reset-password']) {
    const gate = decideMfaGate({ ...pending, pathname, method: 'GET' });
    assert.equal(gate.kind, 'redirect', pathname);
  }
});

test('decideMfaGate: upit (?id=...) se čuva u parametru next, ispravno kodiran', () => {
  const gate = decideMfaGate({ ...pending, pathname: '/chat', search: '?id=5&x=y z', method: 'GET' });
  assert.equal(gate.kind, 'redirect');
  if (gate.kind === 'redirect') {
    const url = new URL(gate.to, 'http://localhost');
    assert.equal(url.pathname, '/login/mfa');
    assert.equal(url.searchParams.get('next'), '/chat?id=5&x=y z');
    assert.deepEqual([...url.searchParams.keys()], ['next']);
  }
});

test('decideMfaGate: početna i stranice za prijavu vode na /login/mfa bez next (podrazumevano je /chat)', () => {
  for (const pathname of ['/', '/login', '/forgot-password']) {
    assert.deepEqual(decideMfaGate({ ...pending, pathname, method: 'GET' }), { kind: 'redirect', to: '/login/mfa' }, pathname);
  }
});

test('decideMfaGate: sam /login/mfa prolazi, uključujući unos koda (POST)', () => {
  for (const pathname of ['/login/mfa', '/login/mfa/']) {
    assert.deepEqual(decideMfaGate({ ...pending, pathname, method: 'GET' }), { kind: 'allow' }, pathname);
    assert.deepEqual(decideMfaGate({ ...pending, pathname, method: 'POST' }), { kind: 'allow' }, `POST ${pathname}`);
  }
});

test('decideMfaGate: sličan prefiks nije izuzetak (/login/mfax, /login/mfa/x, /auth, /authx/)', () => {
  for (const pathname of ['/login/mfax', '/login/mfa/x', '/login/mfa-bypass', '/auth', '/authx/callback', '/auth-admin']) {
    assert.equal(decideMfaGate({ ...pending, pathname, method: 'GET' }).kind, 'redirect', pathname);
  }
});

test('decideMfaGate: /auth/* (callback, confirm) prolazi jer samo uspostavlja sesiju i preusmerava', () => {
  for (const pathname of ['/auth/callback', '/auth/confirm']) {
    assert.deepEqual(decideMfaGate({ ...pending, pathname, method: 'GET' }), { kind: 'allow' }, pathname);
  }
});

test('decideMfaGate: API bez koda se odbija (nema preusmeravanja HTML-om u JSON klijent)', () => {
  for (const method of ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'HEAD']) {
    for (const pathname of ['/api/chat', '/api/ingest', '/api/chats/abc/messages', '/api/', '/api']) {
      assert.deepEqual(decideMfaGate({ ...pending, pathname, method }), { kind: 'deny' }, `${method} ${pathname}`);
    }
  }
});

test('decideMfaGate: stranica sa imenom koje samo liči na /api nije API', () => {
  for (const pathname of ['/api-docs', '/apiary', '/apis']) {
    assert.equal(decideMfaGate({ ...pending, pathname, method: 'GET' }).kind, 'redirect', pathname);
  }
});

test('decideMfaGate: POST na stranicu (server akcija) bez koda se odbija, ne preusmerava', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'Delete']) {
    assert.deepEqual(decideMfaGate({ ...pending, pathname: '/documents', method }), { kind: 'deny' }, method);
  }
});

test('decideMfaGate: HEAD i nedostajući metod se tretiraju kao GET', () => {
  assert.equal(decideMfaGate({ ...pending, pathname: '/chat', method: 'HEAD' }).kind, 'redirect');
  assert.equal(decideMfaGate({ ...pending, pathname: '/chat' }).kind, 'redirect');
});

test('decideMfaGate: nepoznat ili nedostajući nivo uz potvrđen faktor ne propušta', () => {
  for (const aal of [null, undefined, '', 'aal3', 'AAL2']) {
    assert.equal(decideMfaGate({ pathname: '/chat', method: 'GET', verifiedFactors: 1, aal }).kind, 'redirect', String(aal));
    assert.equal(decideMfaGate({ pathname: '/api/chat', method: 'POST', verifiedFactors: 1, aal }).kind, 'deny', String(aal));
  }
});

test('mfaNextPath: putanja na našem sajtu prolazi, bez vrednosti važi /chat', () => {
  assert.equal(mfaNextPath('/documents'), '/documents');
  assert.equal(mfaNextPath('/chat?id=5#kraj'), '/chat?id=5#kraj');
  assert.equal(mfaNextPath('/admin/users'), '/admin/users');
  for (const empty of [undefined, null, '']) assert.equal(mfaNextPath(empty), '/chat');
});

test('mfaNextPath: tuđi sajt i nevažeći oblici padaju na /chat (open redirect), uključujući niz iz URL-a', () => {
  for (const bad of ['//evil.com', '@evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', ['/chat'], ['/a', '/b'], 5, {}]) {
    assert.equal(mfaNextPath(bad), '/chat', JSON.stringify(bad));
  }
});

test('mfaNextPath: /login/mfa kao odredište pada na /chat (bez petlje)', () => {
  for (const loop of ['/login/mfa', '/login/mfa/', '/login/mfa?next=/chat', '/login/mfa#x', '/login/mfa/?a=1']) {
    assert.equal(mfaNextPath(loop), '/chat', loop);
  }
  assert.equal(mfaNextPath('/login/mfax'), '/login/mfax'); // druga putanja, nije petlja
});

test('decideMfaGate: preusmerenje uvek ostaje na našem sajtu, i za čudne putanje', () => {
  for (const pathname of ['//evil.com/x', '/\\evil.com', '/%2F%2Fevil.com', '/@evil.com']) {
    const gate = decideMfaGate({ ...pending, pathname, method: 'GET' });
    assert.equal(gate.kind, 'redirect', pathname);
    if (gate.kind === 'redirect') {
      assert.ok(gate.to.startsWith('/login/mfa'), gate.to);
      assert.equal(new URL(gate.to, 'http://localhost').origin, 'http://localhost');
    }
  }
});
