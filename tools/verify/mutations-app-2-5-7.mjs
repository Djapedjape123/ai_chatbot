// Mutacije povezivanja 2.5.7 i 2.5.8 (stranice, ruta izvoza, server akcija). Dva sloja:
//  - "static": hvata ih `npm test` (lib/admin-guards.test.ts), brzo;
//  - "probe": hvata ih samo proba na pravom `next start` (build + tools/verify/probe-admin-activity.mjs), ~2 minuta po mutaciji.
// Pokretanje iz korena repozitorijuma (traje ~30 minuta): node tools/verify/mutations-app-2-5-7.mjs
// Na kraju pravi čist build i ponovo pušta probu, da .next ne ostane od mutirane verzije.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations, runUnitTests } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (...parts) => path.join(root, ...parts);
const route = f('app', 'api', 'admin', 'audit', 'export', 'route.ts');
const activityPage = f('app', 'admin', 'activity', 'page.tsx');
const settingsPage = f('app', 'admin', 'settings', 'page.tsx');
const actions = f('app', 'admin', 'actions.ts');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildEnv = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-key' };

function build() {
  return spawnSync(npm, ['run', 'build'], { cwd: root, env: buildEnv, encoding: 'utf8', shell: true });
}
function probe() {
  const r = spawnSync(process.execPath, ['tools/verify/probe-admin-activity.mjs'], { cwd: root, encoding: 'utf8', timeout: 600_000 });
  const fails = [...(r.stdout ?? '').matchAll(/^ {2}FAIL (.+)$/gm)].map((m) => m[1]);
  return { code: r.status, fails, summary: /(\d+ provera, \d+ prošlo, \d+ palo)/.exec(r.stdout ?? '')?.[1] ?? 'bez rezimea' };
}

const mutations = [
  // ---- hvata ih statički test (lib/admin-guards.test.ts)
  { layer: 'static', name: 'stranica Aktivnost bez requireAdminPage', file: activityPage, from: "await requireAdminPage('/admin/activity')", to: 'null as never' },
  { layer: 'static', name: 'ruta izvoza bez provere mfa', file: route, from: "if (admin.mfa !== 'ok') return apiError(MFA_REQUIRED_MESSAGE, 403, 'mfa_required');", to: '' },
  { layer: 'static', name: 'stranica Podešavanja dobija metadata (naslov taba otkriva panel)', file: settingsPage, from: 'export default async function AdminSettingsPage() {', to: "export const metadata = { title: 'Podešavanja' };\nexport default async function AdminSettingsPage() {" },
  {
    layer: 'static',
    name: 'updateSettings bez requireAdminAction',
    file: actions,
    from: "const auth = await requireAdminAction();\n  if ('error' in auth) return { status: 'error', error: auth.error, values };\n\n  const parsed = settingsSchema",
    to: "const auth = { admin: null as never };\n\n  const parsed = settingsSchema",
  },

  // ---- hvata ih samo proba na pravom serveru
  { layer: 'probe', name: 'izvoz: zahtev sa tuđeg sajta se ne odbija', file: route, from: "if (isCrossSiteRequest(request.headers.get('sec-fetch-site'))) {", to: 'if (false as boolean) {' },
  { layer: 'probe', name: 'izvoz: neuspeh upisa u audit ne zaustavlja izvoz', file: route, from: 'if (!logged) {', to: 'if (false as boolean) {' },
  { layer: 'probe', name: 'izvoz: gornja granica nije zamrznuta', file: route, from: 'const until = filter.toUtcExclusive < startedAt ? filter.toUtcExclusive : startedAt;', to: 'const until = filter.toUtcExclusive;' },
  { layer: 'probe', name: 'izvoz: zastavica truncated uvek false', file: route, from: 'truncated: count > EXPORT_MAX_ROWS,', to: 'truncated: false,' },
  { layer: 'probe', name: 'izvoz: greška usred strima se guta (fajl izgleda potpun)', file: route, from: 'controller.error(error);', to: 'controller.close();' },
  { layer: 'probe', name: 'izvoz: ceo fajl u jednom delu (nema strima)', file: route, from: 'for (let i = 0; i < CHUNK_ROWS; i++) {', to: 'for (let i = 0; i < 1_000_000; i++) {' },
  { layer: 'probe', name: 'izvoz: čita servisnim ključem umesto JWT-om admina', file: route, from: 'const { supabase, user } = admin;', to: "const { user } = admin;\n  const supabase = (await import('@/lib/supabase')).supabaseAdmin;" },
  { layer: 'probe', name: 'izvoz: upis u audit PRE brojanja zamenjen upisom bez broja (rows uvek 0)', file: route, from: 'rows: total,', to: 'rows: 0,' },
  { layer: 'probe', name: 'stranica: strana od 50 bez reda za proveru sledeće (nema "Starije")', file: activityPage, from: 'auditPageQuery(supabase, filter, PAGE_SIZE + 1)', to: 'auditPageQuery(supabase, filter, PAGE_SIZE)' },
  { layer: 'probe', name: 'stranica: filteri iz URL-a se ignorišu', file: activityPage, from: 'parseAuditFilter(await searchParams, now)', to: 'parseAuditFilter({}, now)' },
  { layer: 'probe', name: 'stranica: veza "Starije" ne nosi period', file: activityPage, from: 'const params = auditFilterParams(filter);', to: 'const params = new URLSearchParams();' },
  { layer: 'probe', name: 'akcija: snima i kad nema promena', file: actions, from: 'if (settingsUnchanged(current, parsed.data)) return { status: \'success\', message: \'Nema promena.\' };', to: '' },
  { layer: 'probe', name: 'akcija: RPC ide servisnim ključem umesto JWT-om admina', file: actions, from: "auth.admin.supabase.rpc('admin_update_settings'", to: "supabaseAdmin.rpc('admin_update_settings'" },
  {
    layer: 'probe',
    name: 'updateSettings proverava admina, ali ne i aal2 (requireAdmin umesto requireAdminAction)',
    file: actions,
    from: "const auth = await requireAdminAction();\n  if ('error' in auth) return { status: 'error', error: auth.error, values };\n\n  const parsed = settingsSchema",
    to: "const admin = await (await import('@/lib/require-admin')).requireAdmin();\n  if (!admin) return { status: 'error', error: 'Neautorizovan pristup.', values };\n  const auth = { admin };\n\n  const parsed = settingsSchema",
  },
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
  { label: 'Mutacije povezivanja (2.5.7 i 2.5.8)' },
);

if (!only || only === 'probe') {
  console.log('\nČist build i kontrolna proba posle vraćanja fajlova...');
  const b = build();
  const p = b.status === 0 ? probe() : { code: 1, summary: 'build pada' };
  console.log(`kontrola: build ${b.status === 0 ? 'prolazi' : 'PADA'}, proba: ${p.summary}`);
  if (b.status !== 0 || p.code !== 0) process.exit(1);
}
process.exit(intact && results.every((r) => r.status === 'UHVAĆENA') ? 0 : 1);
