import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readIsAdmin, toMeBody } from './me.ts';

// GET /api/me (2.5.9) služi samo da meni zna da li da prikaže vezu ka admin panelu. Veza olakšava ulaz, a stvarnu zaštitu
// daje panel (404 za advokata, aal2, baza). Zato odgovor sme da sadrži samo ulogu, a svaka dvosmislenost znači "nije admin".

test('toMeBody: admin i advokat', () => {
  assert.deepEqual(toMeBody({ role: 'admin' }), { role: 'admin' });
  assert.deepEqual(toMeBody({ role: 'lawyer' }), { role: 'lawyer' });
});

test('toMeBody vraća samo ulogu, ma šta red profila sadrži', () => {
  const row = { id: '11111111-1111-4111-8111-111111111111', role: 'admin', email: 'a@kancelarija.rs', full_name: 'Ana', disabled_at: null };
  assert.deepEqual(Object.keys(toMeBody(row)), ['role']);
  assert.equal(JSON.stringify(toMeBody(row)), '{"role":"admin"}');
});

test('toMeBody: sve što nije tačno "admin" je advokat (zatvoreno pravilo)', () => {
  const notAdmin: unknown[] = [null, undefined, {}, { role: null }, { role: 'ADMIN' }, { role: ' admin' }, { role: 'superadmin' }, { role: true }, { role: ['admin'] }, 'admin', 42, ['admin']];
  for (const profile of notAdmin) {
    assert.deepEqual(toMeBody(profile), { role: 'lawyer' }, JSON.stringify(profile));
  }
});

test('readIsAdmin: veza ka panelu se prikazuje samo za telo { role: "admin" }', () => {
  assert.equal(readIsAdmin({ role: 'admin' }), true);
  const notAdmin: unknown[] = [null, undefined, {}, { role: 'lawyer' }, { role: 'Admin' }, { role: true }, { error: 'Greška.', code: 'me_failed' }, { user: { role: 'admin' } }, 'admin', ['admin'], [{ role: 'admin' }]];
  for (const data of notAdmin) {
    assert.equal(readIsAdmin(data), false, JSON.stringify(data));
  }
});

// Statička provera rute (isti obrazac kao lib/admin-guards.test.ts): ne zamenjuje probu na pravom serveru, ali hvata
// ono što bi izmena rute tiho pokvarila.
const root = path.resolve(import.meta.dirname, '..');
const routeSource = () => fs.readFileSync(path.join(root, 'app', 'api', 'me', 'route.ts'), 'utf8');

test('/api/me: requireUser() pre upita, čitanje preko korisničkog klijenta, samo kolona role', () => {
  const source = routeSource();
  const guard = source.indexOf('await requireUser()');
  const query = source.indexOf(".from('profiles')");
  assert.ok(guard >= 0 && query > guard, 'requireUser() mora biti pre upita ka profilima');
  assert.doesNotMatch(source, /supabaseAdmin|from '@\/lib\/supabase'/);
  assert.match(source, /\.select\('role'\)/);
});

test('/api/me odgovara samo preko toMeBody() i ne sme da se kešira', () => {
  const source = routeSource();
  assert.match(source, /NextResponse\.json\(toMeBody\(/);
  assert.match(source, /no-store/);
});
