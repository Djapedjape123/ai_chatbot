// Mutacije povezivanja Faze 3.5 (slike sa telefona): /api/chat sa slikama, /api/ingest/transcribe, /api/ingest/text,
// lib/ingest-pipeline.ts. Dva sloja:
//  - "static": hvata ih `npm test` (lib/image-guards.test.ts, lib/file-guards.test.ts), brzo;
//  - "probe": hvata ih proba na pravom `next start` (build + tools/verify/probe-camera-images.mjs), ~2 min po mutaciji.
// Pokretanje iz korena repozitorijuma: node tools/verify/mutations-app-faza35.mjs [static|probe] [deo imena]
// Na kraju pravi čist build i ponovo pušta probu, da .next ne ostane od mutirane verzije.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations, runUnitTests } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (...parts) => path.join(root, ...parts);
const chat = f('app', 'api', 'chat', 'route.ts');
const transcribe = f('app', 'api', 'ingest', 'transcribe', 'route.ts');
const textRoute = f('app', 'api', 'ingest', 'text', 'route.ts');
const pipeline = f('lib', 'ingest-pipeline.ts');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildEnv = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fake-anon-key' };

function build() {
  return spawnSync(npm, ['run', 'build'], { cwd: root, env: buildEnv, encoding: 'utf8', shell: true });
}
function probe() {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'tools/verify/probe-camera-images.mjs'],
    { cwd: root, encoding: 'utf8', timeout: 600_000 }
  );
  const fails = [...(r.stdout ?? '').matchAll(/^ {2}FAIL (.+)$/gm)].map((m) => m[1]);
  return { code: r.status, fails, summary: /(\d+ provera prošlo, \d+ palo)/.exec(r.stdout ?? '')?.[1] ?? 'bez rezimea' };
}

const mutations = [
  // ---- hvata ih statički test
  { layer: 'static', name: 'chat: audit odbijene slike bez konteksta', file: chat, from: "metadata: { ...d.audit, file_kind: 'image', context: 'chat_image', ", to: "metadata: { ...d.audit, file_kind: 'image', " },
  { layer: 'static', name: 'chat: u istoriju ide pitanje bez oznake slika', file: chat, from: 'content: images.length > 0 ? imageMessageContent(images.length, trimmedQuery) : trimmedQuery,', to: 'content: trimmedQuery,' },
  { layer: 'static', name: 'prepis: bez IP burst zaštite', file: transcribe, from: 'const burstBlock = await enforceIpBurst(ip);', to: 'const burstBlock = null as Response | null;' },
  { layer: 'static', name: 'prepis: audit odbijene slike dobija naziv fajla', file: transcribe, from: "context: 'transcribe', size_bytes: image.size },", to: "context: 'transcribe', size_bytes: image.size, name: image.name }," },
  { layer: 'static', name: 'tekst: dokument se upisuje kao PDF', file: textRoute, from: "fileKind: 'image',", to: "fileKind: 'pdf'," },
  { layer: 'static', name: 'pipeline: document_uploaded bez vrste fajla', file: pipeline, from: '          file_kind: fileKind,\n', to: '' },

  // ---- hvata ih proba na pravom serveru
  { layer: 'probe', name: 'chat: Claude dobija sirovu sliku (sa EXIF-om)', file: chat, from: '      images = checked.images;', to: '      images = await Promise.all(checked.images.map(async (img, i) => ({ ...img, bytes: new Uint8Array(await files[i].arrayBuffer()) })));' },
  { layer: 'probe', name: 'chat: system prompt bez pravila za slike', file: chat, from: 'buildSystemPrompt(buildRagContext(sources), { images: images.length })', to: 'buildSystemPrompt(buildRagContext(sources))' },
  { layer: 'probe', name: 'chat: procena rezervacije bez slika', file: chat, from: 'estimateChatTokens(trimmedQuery, formattedHistory.map((h) => h.content)) + imageTokens,', to: 'estimateChatTokens(trimmedQuery, formattedHistory.map((h) => h.content)),' },
  { layer: 'probe', name: 'chat: audit bez broja slika', file: chat, from: '        ...(images.length > 0 ? { images: images.length } : {}),\n', to: '' },
  { layer: 'probe', name: 'chat: poruka odbijanja kao za bazu znanja', file: chat, from: "describeRejection(checked.rejection, 'image')", to: 'describeRejection(checked.rejection)' },
  { layer: 'probe', name: 'chat: slike idu Claude-u i u narednim pitanjima (istorija sa slikama)', file: chat, from: "{ role: 'user', content: images.length > 0 ? buildImageUserContent(images, trimmedQuery) : trimmedQuery },", to: "{ role: 'user', content: buildImageUserContent(images, trimmedQuery) },", equivalent: 'istorija dolazi iz baze kao tekst (slika se ne čuva), pa ni posle mutacije Claude ne dobija sliku u narednom pitanju; bez slika mutacija samo pretvara tekst u niz sa jednim tekst blokom, što API tretira isto' },
  { layer: 'probe', name: 'prepis: zatvara se kao settle (dokument bi se brojao dvaput)', file: transcribe, from: 'if (reservation) await releaseUsage(reservation.id, reservation.userId, spent);', to: "if (reservation) await (await import('@/lib/usage')).settleUsage(reservation.id, reservation.userId, spent);" },
  { layer: 'probe', name: 'prepis: oznaka [NEMA TEKSTA] prolazi kao tekst', file: transcribe, from: '    if (text === null) {', to: '    if (false as boolean) {' },
  { layer: 'probe', name: 'prepis: oznaka truncated se ne šalje', file: transcribe, from: "truncated: claude.stopReason === 'max_tokens'", to: 'truncated: false' },
  { layer: 'probe', name: 'tekst: naziv se ne čisti', file: textRoute, from: 'const title = sanitizeTitle(parsed.data.title);', to: 'const title = parsed.data.title;' },
  { layer: 'probe', name: 'pipeline: broj strana ne ide u audit', file: pipeline, from: '          ...pageMeta,\n', to: '' },
  { layer: 'probe', name: 'tekst: potvrda sumnjivog sadržaja se ignoriše', file: textRoute, from: '      acknowledge,\n', to: '      acknowledge: false,\n' },
];

const only = process.argv[2];
const nameFilter = process.argv[3];
const selected = (only ? mutations.filter((m) => m.layer === only) : mutations).filter((m) => !nameFilter || m.name.includes(nameFilter));

const { results, intact } = await runMutations(
  selected,
  (m) => {
    if (m.layer === 'static') return runUnitTests(root);
    const b = build();
    if (b.status !== 0) return { invalid: true, failed: false, detail: `build pada: ${(b.stdout + b.stderr).split('\n').find((l) => /error|Error|Type/.test(l))?.slice(0, 120)}` };
    const p = probe();
    return { failed: p.code !== 0, detail: `${p.summary}; pale: ${p.fails.slice(0, 2).join(' | ').slice(0, 130)}` };
  },
  { label: 'Mutacije povezivanja (Faza 3.5)' }
);

if (!only || only === 'probe') {
  console.log('\nČist build i kontrolna proba posle vraćanja fajlova...');
  const b = build();
  const p = b.status === 0 ? probe() : { code: 1, summary: 'build pada' };
  console.log(`kontrola: build ${b.status === 0 ? 'prolazi' : 'PADA'}, proba: ${p.summary}`);
  if (b.status !== 0 || p.code !== 0) process.exit(1);
}
process.exit(intact && results.every((r) => r.status === 'UHVAĆENA') ? 0 : 1);
