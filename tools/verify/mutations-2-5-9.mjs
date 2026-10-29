// Namerne greške 2.5.9 (GET /api/me, meni u chatu). Dva sloja:
//  - "static": hvata ih `npm test` (lib/me.test.ts), brzo;
//  - "probe": hvata ih samo proba u pregledaču (build + tools/verify/probe-sidebar-entry.mjs), ~2 minuta po mutaciji.
// Pokretanje iz korena repozitorijuma: node tools/verify/mutations-2-5-9.mjs [static|probe]
// Na kraju pravi čist build i ponovo pušta probu, da .next ne ostane od mutirane verzije.
// Ne pokretati dok se menjaju isti fajlovi, ni zajedno sa build-om ili `npm test`: runner prepisuje izvorne fajlove.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations, runUnitTests } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (...parts) => path.join(root, ...parts);
const meLib = f('lib', 'me.ts');
const route = f('app', 'api', 'me', 'route.ts');
const sidebar = f('app', 'components', 'Sidebar.tsx');
const chatPage = f('app', 'chat', 'page.tsx');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildEnv = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-key' };

function build() {
  return spawnSync(npm, ['run', 'build'], { cwd: root, env: buildEnv, encoding: 'utf8', shell: true });
}
function probe() {
  const r = spawnSync(process.execPath, ['tools/verify/probe-sidebar-entry.mjs'], { cwd: root, encoding: 'utf8', timeout: 600_000 });
  const fails = [...(r.stdout ?? '').matchAll(/^ {2}FAIL (.+)$/gm)].map((m) => m[1]);
  return { code: r.status, fails, summary: /(\d+ provera, \d+ prošlo, \d+ palo)/.exec(r.stdout ?? '')?.[1] ?? 'bez rezimea' };
}

const mutations = [
  // ---- hvata ih `npm test`
  { layer: 'static', name: 'toMeBody: sve što nije "lawyer" postaje admin (otvoreno pravilo)', file: meLib, from: "return { role: isAdminRole(field(profile, 'role')) ? 'admin' : 'lawyer' };", to: "return { role: field(profile, 'role') === 'lawyer' ? 'lawyer' : 'admin' };" },
  { layer: 'static', name: 'toMeBody vraća ceo red profila', file: meLib, from: "return { role: isAdminRole(field(profile, 'role')) ? 'admin' : 'lawyer' };", to: 'return profile as MeBody;' },
  { layer: 'static', name: 'readIsAdmin: svaka uloga otvara vezu', file: meLib, from: "return isAdminRole(field(data, 'role'));", to: "return field(data, 'role') !== undefined;" },
  { layer: 'static', name: 'ruta bira sve kolone profila', file: route, from: ".select('role')", to: ".select('*')" },
  { layer: 'static', name: 'ruta se kešira (nema no-store)', file: route, from: ", { headers: { 'Cache-Control': 'private, no-store' } }", to: '' },
  { layer: 'static', name: 'ruta vraća red profila umesto toMeBody', file: route, from: 'toMeBody(data)', to: 'data' },
  { layer: 'static', name: 'ruta čita servisnim ključem (supabaseAdmin)', file: route, from: "await supabase.from('profiles')", to: "await (await import('@/lib/supabase')).supabaseAdmin.from('profiles')" },

  // ---- hvata ih samo proba u pregledaču / na pravom serveru
  { layer: 'probe', name: 'meni: veza "Admin panel" se prikazuje svima', file: sidebar, from: '{isAdmin && (', to: '{(true as boolean) && (' },
  { layer: 'probe', name: 'meni: veza "Bezbednost naloga" vodi na pogrešnu adresu', file: sidebar, from: 'href="/account/security"', to: 'href="/security"' },
  { layer: 'probe', name: 'meni: veza ka panelu bez prefetch={false} (prefetch pri prikazu)', file: sidebar, from: 'prefetch={false}', to: '' },
  { layer: 'probe', name: 'chat: isAdmin se ne prosleđuje meniju', file: chatPage, from: 'isAdmin={isAdmin}', to: 'isAdmin={false}' },
  { layer: 'probe', name: 'chat: isAdmin je uvek true (ignoriše odgovor /api/me)', file: chatPage, from: 'setIsAdmin(readIsAdmin(data))', to: 'setIsAdmin(true)' },
  { layer: 'probe', name: 'ruta: uloga se čita servisnim ključem (proba, ne statički test)', file: route, from: "await supabase.from('profiles')", to: "await (await import('@/lib/supabase')).supabaseAdmin.from('profiles')" },
  { layer: 'probe', name: 'ruta: bira sve kolone profila (proba, ne statički test)', file: route, from: ".select('role')", to: ".select('*')" },
  { layer: 'probe', name: 'ruta: greška čitanja uloge se guta (200 umesto 500)', file: route, from: 'if (error) {', to: 'if (false as boolean) {' },
  { layer: 'probe', name: 'ruta: bez Cache-Control zaglavlja (proba, ne statički test)', file: route, from: ", { headers: { 'Cache-Control': 'private, no-store' } }", to: '' },
];

const only = process.argv[2]; // npr. "static" za brzu seriju
const selected = only ? mutations.filter((m) => m.layer === only) : mutations;

const { results, intact } = await runMutations(
  selected,
  (m) => {
    if (m.layer === 'static') return runUnitTests(root);
    const b = build();
    if (b.status !== 0) return { invalid: true, failed: false, detail: `build pada: ${(b.stdout + b.stderr).split('\n').find((l) => /error|Error|Type/.test(l))?.slice(0, 120)}` };
    const p = probe();
    return { failed: p.code !== 0, detail: `${p.summary}; pale: ${p.fails.slice(0, 2).join(' | ').slice(0, 130)}` };
  },
  { label: 'Mutacije 2.5.9 (/api/me i meni u chatu)' },
);

if (!only || only === 'probe') {
  console.log('\nČist build i kontrolna proba posle vraćanja fajlova...');
  const b = build();
  const p = b.status === 0 ? probe() : { code: 1, summary: 'build pada' };
  console.log(`kontrola: build ${b.status === 0 ? 'prolazi' : 'PADA'}, proba: ${p.summary}`);
  if (b.status !== 0 || p.code !== 0) process.exit(1);
}
process.exit(intact && results.every((r) => r.status === 'UHVAĆENA') ? 0 : 1);
