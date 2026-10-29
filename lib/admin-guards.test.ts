import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Statička provera pravila admin panela (CLAUDE.md, "Trajna bezbednosna pravila" i plan 2.5). Ne zamenjuje probu na pravom
// serveru, ali hvata ono što bi nova stranica, ruta ili akcija mogla tiho da zaboravi:
//  - svaka stranica u app/admin zove requireAdminPage(), jer layout ne štiti navigaciju unutar panela (Partial Rendering)
//  - stranice panela nemaju metadata (naslov taba bi otkrio da panel postoji)
//  - svaka ruta u app/api/admin zove requireAdmin() i proverava mfa
//  - svaka server akcija u app/admin/actions.ts zove requireAdminAction() PRE bilo kog upita ili upisa

const root = path.resolve(import.meta.dirname, '..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}
const rel = (file: string) => path.relative(root, file).replaceAll('\\', '/');
const read = (file: string) => fs.readFileSync(file, 'utf8');

const adminFiles = walk(path.join(root, 'app', 'admin'));
const pages = adminFiles.filter((f) => /[\\/]page\.tsx$/.test(f));

test('app/admin ima stranice (provera nije prazna)', () => {
  assert.ok(pages.length >= 5, pages.map(rel).join(', '));
});

test('svaka stranica u app/admin poziva requireAdminPage() sa svojom putanjom', () => {
  for (const file of pages) {
    const source = read(file);
    // putanja može biti literal ili izraz sa šablonom (stranica jednog naloga: `/admin/users/${id}`)
    assert.match(source, /await requireAdminPage\([^)]*['`]\/admin[^'`]*['`]/, rel(file));
  }
});

test('layout panela poziva requireAdminPage()', () => {
  assert.match(read(path.join(root, 'app', 'admin', 'layout.tsx')), /await requireAdminPage\('\/admin'\)/);
});

test('nijedan fajl u app/admin nema metadata (naslov taba ne sme da otkrije panel)', () => {
  for (const file of adminFiles.filter((f) => /\.tsx?$/.test(f))) {
    const code = read(file)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    assert.doesNotMatch(code, /export\s+(const\s+metadata|(async\s+)?function\s+generateMetadata)/, rel(file));
  }
});

test('svaka ruta u app/api/admin poziva requireAdmin() i odbija nalog bez aal2 (mfa !== "ok")', () => {
  const routes = walk(path.join(root, 'app', 'api', 'admin')).filter((f) => /[\\/]route\.ts$/.test(f));
  assert.ok(routes.length >= 1);
  for (const file of routes) {
    const source = read(file);
    assert.match(source, /await requireAdmin\(\)/, rel(file));
    assert.match(source, /admin\.mfa !== 'ok'/, rel(file));
    // provera mora da bude pre prvog upita ka bazi
    const guard = source.indexOf('admin.mfa');
    const firstQuery = Math.min(...['auditCountQuery(', 'auditPageQuery(', '.rpc(', 'supabaseAdmin', 'writeAudit('].map((s) => source.indexOf(s)).filter((i) => i >= 0));
    assert.ok(guard >= 0 && guard < firstQuery, `${rel(file)}: provera admina mora biti pre prvog upita`);
  }
});

test('svaka izvezena server akcija u app/admin/actions.ts poziva requireAdminAction() pre upita ili upisa', () => {
  const source = read(path.join(root, 'app', 'admin', 'actions.ts'));
  const parts = source.split(/^export async function /m).slice(1);
  assert.ok(parts.length >= 6, `${parts.length} akcija`);
  for (const part of parts) {
    const name = /^(\w+)/.exec(part)?.[1];
    const guard = part.indexOf('requireAdminAction()');
    assert.ok(guard >= 0, `${name}: nema requireAdminAction()`);
    // \b: "resendInvite(" sadrži podniz "sendInvite(", ali to nije poziv pomoćne funkcije
    const firstUse = part.search(/\.rpc\(|\bsupabaseAdmin\b|\.from\(|\blogAudit\(|\bsendInvite\(/);
    assert.ok(firstUse < 0 || guard < firstUse, `${name}: requireAdminAction() mora biti pre prvog upita ili upisa`);
  }
});

test('akcije u app/admin/actions.ts su samo async funkcije (use server izvozi samo to)', () => {
  const source = read(path.join(root, 'app', 'admin', 'actions.ts'));
  assert.match(source, /^'use server';/m);
  const exported = [...source.matchAll(/^export\s+(?!async function)(\w+)/gm)].map((m) => m[0]);
  assert.deepEqual(exported, []);
});
