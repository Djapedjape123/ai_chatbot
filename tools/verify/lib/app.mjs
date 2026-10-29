// Pokretanje pravog `next start` i pomoćne funkcije za probu: kolačić sesije, HTTP pozivi, pozivanje server akcija.
// Build mora da bude napravljen sa NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 (NEXT_PUBLIC_* se ugrađuje pri build-u).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANON_KEY, SERVICE_KEY, makeJwt } from './fake-supabase.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SUPABASE_URL = 'http://127.0.0.1:54321';

export async function startApp({ port = 3111, env = {} } = {}) {
  const buildId = path.join(REPO_ROOT, '.next', 'BUILD_ID');
  if (!fs.existsSync(buildId)) throw new Error('Nema .next/BUILD_ID. Prvo: NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 npm run build');

  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      VERCEL: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await fetch(`${base}/login`, { redirect: 'manual' });
      break;
    } catch {
      if (child.exitCode !== null) throw new Error(`next start je završio (kod ${child.exitCode}):\n${log}`);
      if (Date.now() > deadline) throw new Error(`next start ne odgovara:\n${log}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return {
    base,
    log: () => log,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}

// sb-<prvi deo hosta>-auth-token = base64-<base64url(JSON sesije)> (@supabase/ssr; kratak token ne pravi delove)
export function sessionCookie(user, { aal = 'aal1' } = {}) {
  const accessToken = makeJwt({ sub: user.id, aal });
  const session = {
    access_token: accessToken,
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4_102_444_800,
    user: { id: user.id, email: user.email, aud: 'authenticated' },
  };
  return `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

export async function get(app, pathAndQuery, { cookie, headers = {} } = {}) {
  const res = await fetch(`${app.base}${pathAndQuery}`, { redirect: 'manual', headers: { ...(cookie ? { cookie } : {}), ...headers } });
  // Bajtovi pa tekst: Response.text() sam odbacuje UTF-8 BOM, a on je deo onoga što izvoz treba da pošalje
  const raw = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, location: res.headers.get('location'), body: raw.toString('utf8'), raw };
}

// Tekst stranice bez oznaka i React komentara (<!-- -->), sa osnovnim HTML entitetima
export function textOf(html) {
  return html
    .replace(/<!--.*?-->/gs, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');
}

// Svi href-ovi iz HTML-a (sa dekodiranim &amp;)
export function hrefsOf(html) {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

// Poziv server akcije preko HTTP-a. ID akcije je u .next/server/server-reference-manifest.json (ključ node, po exportedName).
// useActionState forme React šalje kao multipart: polja formulara sa prefiksom "_1_", a koren "0" = [stanje, "$K1"] POSLEDNJI
// (busboy čita u toku, pa koren pre polja daje prazan FormData).
export function findActionId(exportedName) {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.next', 'server', 'server-reference-manifest.json'), 'utf8'));
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    if (entry.exportedName === exportedName) return { id, pages: Object.keys(entry.workers ?? {}) };
  }
  throw new Error(`Akcija ${exportedName} nije u manifestu`);
}

export async function callFormAction(app, { exportedName, page, cookie, fields, prefix = '_1_', previousState = { status: 'idle' } }) {
  const { id, pages } = findActionId(exportedName);
  const target = pages.find((p) => p === page) ?? pages[0];
  const route = `/${target.replace(/^app\//, '').replace(/\/page$/, '')}`;
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(`${prefix}${name}`, value);
  form.append('0', JSON.stringify([previousState, '$K1']));
  const res = await fetch(`${app.base}${route}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Next-Action': id, Accept: 'text/x-component', Origin: app.base, ...(cookie ? { cookie } : {}) },
    body: form,
  });
  return { status: res.status, body: await res.text(), route };
}
