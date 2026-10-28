import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IP_BURST_LIMIT,
  IP_BURST_WINDOW_SECONDS,
  decideIpBurst,
  getIpBurstLimit,
  ipBurstKey,
  secondsUntilNextWindow,
} from './ip-burst.ts';

type HitArgs = { key: string; limit: number; windowSeconds: number };

// Zamena za RPC hit_ip_rate_limit: pamti poziv, a odgovor određuje test
function fakeHit(response: { data: unknown; error?: unknown } | Error) {
  const calls: HitArgs[] = [];
  const hit = async (key: string, limit: number, windowSeconds: number) => {
    calls.push({ key, limit, windowSeconds });
    if (response instanceof Error) throw response;
    return { data: response.data, error: response.error ?? null };
  };
  return { hit, calls };
}

test('getIpBurstLimit: bez env-a važi 60 zahteva u minuti', () => {
  assert.equal(getIpBurstLimit({}), DEFAULT_IP_BURST_LIMIT);
  assert.equal(DEFAULT_IP_BURST_LIMIT, 60);
  assert.equal(IP_BURST_WINDOW_SECONDS, 60);
});

test('getIpBurstLimit: ispravna vrednost se koristi', () => {
  assert.equal(getIpBurstLimit({ IP_BURST_LIMIT: ' 120 ' }), 120);
});

test('getIpBurstLimit: neispravna vrednost ne isključuje limit, već pada na podrazumevanu', () => {
  for (const bad of ['', '0', '-5', '1.5', 'abc', '1e9', '99999999999999999999']) {
    assert.equal(getIpBurstLimit({ IP_BURST_LIMIT: bad }), DEFAULT_IP_BURST_LIMIT, `IP_BURST_LIMIT=${bad}`);
  }
});

test('secondsUntilNextWindow: sekunde do početka sledećeg prozora, najmanje 1', () => {
  assert.equal(secondsUntilNextWindow(120_000, 60), 60, 'tačno na granici počinje nov prozor');
  assert.equal(secondsUntilNextWindow(90_500, 60), 30, 'zaokruženo naviše');
  assert.equal(secondsUntilNextWindow(119_999, 60), 1, 'nikad 0');
});

test('ipBurstKey: IPv4 ostaje isti', () => {
  assert.equal(ipBurstKey('203.0.113.9'), '203.0.113.9');
});

test('ipBurstKey: IPv6 adrese iz iste /64 mreže dele ključ (rotacija adresa ne zaobilazi limit)', () => {
  const a = ipBurstKey('2001:db8:1:2::1');
  const b = ipBurstKey('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd');
  assert.equal(a, '2001:db8:1:2:0:0:0:0/64');
  assert.equal(b, a);
});

test('ipBurstKey: IPv6 adrese iz različitih /64 mreža imaju različit ključ', () => {
  assert.notEqual(ipBurstKey('2001:db8:1:2::1'), ipBurstKey('2001:db8:1:3::1'));
});

test('ipBurstKey: skraćeni zapis sa :: se ispravno proširuje', () => {
  assert.equal(ipBurstKey('2001:db8::1:2:3'), '2001:db8:0:0:0:0:0:0/64');
  assert.equal(ipBurstKey('2001:db8:5:6:7::9'), '2001:db8:5:6:0:0:0:0/64');
});

test('ipBurstKey: IPv4 upakovan u IPv6 vraća IPv4 (inače bi svi delili ključ ::/64)', () => {
  assert.equal(ipBurstKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipBurstKey('::ffff:cb00:7109'), '203.0.113.9');
});

test('decideIpBurst: bez poverljive IP adrese nema brojanja i zahtev prolazi', async () => {
  const { hit, calls } = fakeHit({ data: false });
  assert.deepEqual(await decideIpBurst(null, hit, 0, {}), { kind: 'allow' });
  assert.equal(calls.length, 0);
});

test('decideIpBurst: baza kaže da je zahtev dozvoljen', async () => {
  const { hit, calls } = fakeHit({ data: true });
  assert.deepEqual(await decideIpBurst('203.0.113.9', hit, 0, {}), { kind: 'allow' });
  assert.deepEqual(calls, [{ key: '203.0.113.9', limit: 60, windowSeconds: 60 }]);
});

test('decideIpBurst: limit iz env-a ide u bazu, a IPv6 ide kao /64', async () => {
  const { hit, calls } = fakeHit({ data: true });
  await decideIpBurst('2001:db8:1:2::77', hit, 0, { IP_BURST_LIMIT: '5' });
  assert.deepEqual(calls, [{ key: '2001:db8:1:2:0:0:0:0/64', limit: 5, windowSeconds: 60 }]);
});

test('decideIpBurst: preko limita je blokada sa preostalim sekundama prozora', async () => {
  const { hit } = fakeHit({ data: false });
  assert.deepEqual(await decideIpBurst('203.0.113.9', hit, 90_500, {}), { kind: 'blocked', retryAfterSeconds: 30 });
});

test('decideIpBurst: greška baze ne propušta zahtev (fail-closed), čak ni uz data=true', async () => {
  for (const data of [null, true, false]) {
    const { hit } = fakeHit({ data, error: { message: 'boom' } });
    assert.deepEqual(await decideIpBurst('203.0.113.9', hit, 0, {}), { kind: 'unavailable' }, String(data));
  }
});

test('decideIpBurst: izuzetak pri pozivu baze ne propušta zahtev (fail-closed)', async () => {
  const { hit } = fakeHit(new Error('network down'));
  assert.deepEqual(await decideIpBurst('203.0.113.9', hit, 0, {}), { kind: 'unavailable' });
});

test('decideIpBurst: odgovor koji nije boolean ne propušta zahtev (fail-closed)', async () => {
  for (const data of [null, undefined, 'true', 1, [true]]) {
    const { hit } = fakeHit({ data });
    assert.deepEqual(await decideIpBurst('203.0.113.9', hit, 0, {}), { kind: 'unavailable' }, String(data));
  }
});
