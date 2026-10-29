// Proba 2.5.9 (ulaz u panel): GET /api/me i veze u meniju chata, na pravom `next start` sa lažnim Supabase-om.
//
// Stranica /chat je klijentska komponenta i ulogu dobija iz /api/me tek posle učitavanja, pa HTML sa servera NIKAD ne
// sadrži vezu ka panelu (ni za admina). Zato se meni proverava u pravom pregledaču (Edge preko playwright-core, koji je
// u node_modules kao zavisnost next-a, bez nove instalacije), a HTML sa servera posebno.
// Pokretanje: vidi README.md. Izlaz: jedna linija po proveri; kod izlaza je 1 ako je bilo koja pala.

import { chromium } from 'playwright-core';
import { createFakeSupabase } from './lib/fake-supabase.mjs';
import { get, hrefsOf, sessionCookie, startApp, textOf } from './lib/app.mjs';

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `\n         ${String(detail).slice(0, 600).replace(/\n/g, '\n         ')}` : ''}`);
  }
}
const section = (title) => console.log(`\n${title}`);

const fake = createFakeSupabase();
const A = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@kancelarija.rs', role: 'admin', full_name: 'Admin Admić', factors: [{ id: 'f1', status: 'verified', factor_type: 'totp' }] };
const L = { id: '22222222-2222-4222-8222-222222222222', email: 'ana@kancelarija.rs', role: 'lawyer', full_name: 'Ana Anić' };
const N = { id: '33333333-3333-4333-8333-333333333333', email: 'bez-mfa@kancelarija.rs', role: 'admin', factors: [] };
const B = { id: '44444444-4444-4444-8444-444444444444', email: 'blokiran@kancelarija.rs', role: 'admin', factors: A.factors, disabled_at: '2026-10-29T09:00:00+00:00' };
const P = { id: '55555555-5555-4555-8555-555555555555', email: 'bez-profila@kancelarija.rs', role: 'lawyer', noProfile: true };

const cookies = {
  admin: sessionCookie(A, { aal: 'aal2' }),
  adminAal1: sessionCookie(A, { aal: 'aal1' }),
  lawyer: sessionCookie(L),
  noMfa: sessionCookie(N),
  blocked: sessionCookie(B, { aal: 'aal2' }),
  noProfile: sessionCookie(P),
};

function seed() {
  fake.reset();
  for (const u of [A, L, N, B, P]) fake.addUser(u);
}

const isProfileRead = (r) => r.path === '/rest/v1/profiles';
const isWrite = (r) => r.path.startsWith('/rest/') && r.method !== 'GET' && r.method !== 'HEAD';
const isAdminPath = (p) => p === '/admin' || p.startsWith('/admin/');
const VIEWPORT = { width: 1280, height: 800 }; // md i šire: meni je uvek vidljiv

async function main() {
  await fake.start();
  const app = await startApp({ port: 3111 });
  let browser = null;

  // Otvara /chat sa datim kolačićem i čeka da se stranica smiri (odgovor /api/me stigao, React ga obradio)
  async function openChat(cookie) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const eq = cookie.indexOf('=');
    await context.addCookies([{ name: cookie.slice(0, eq), value: cookie.slice(eq + 1), url: app.base }]);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const requests = [];
    const errors = [];
    page.on('request', (req) => requests.push(new URL(req.url()).pathname));
    page.on('pageerror', (error) => errors.push(error.message));
    const meResponse = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/me', { timeout: 8000 }).catch(() => null);
    await page.goto(`${app.base}/chat`, { waitUntil: 'load' });
    const me = await meResponse;
    await page.getByRole('button', { name: '+ Novi razgovor' }).waitFor();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return { context, page, requests, errors, me, meBody: me ? await me.text().catch(() => '') : null };
  }

  // Jedan scenario: svež lažni server, nova sesija pregledača. Izuzetak (npr. istek vremena na kliku) je pala provera,
  // a ne kraj probe; kontekst se uvek zatvara.
  async function scenario(label, cookie, body, { failure } = {}) {
    seed();
    if (failure) fake.state.failures.set(...failure);
    let s = null;
    try {
      s = await openChat(cookie);
      await body(s);
    } catch (error) {
      check(`${label}: scenario nije dovršen`, false, String(error.message).split('\n')[0]);
    } finally {
      await s?.context.close();
      fake.state.failures.clear();
    }
  }
  const adminLinks = (page) => page.locator('a[href="/admin"], a[href^="/admin/"]');
  const securityLink = (page) => page.locator('a[href="/account/security"]').filter({ hasText: 'Bezbednost naloga' });
  const appears = (locator) => locator.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);

  try {
    // ---------------------------------------------------------------- GET /api/me preko HTTP-a
    section('GET /api/me');
    seed();
    let m = fake.mark();
    let r = await get(app, '/api/me');
    check('odjavljen -> /login (proxy), bez uloge u telu', r.status === 307 && r.location?.endsWith('/login') && !/role/.test(r.body), `${r.status} ${r.location}`);

    m = fake.mark();
    r = await get(app, '/api/me', { cookie: cookies.lawyer });
    check('advokat: 200 i telo je tačno {"role":"lawyer"}', r.status === 200 && r.body === '{"role":"lawyer"}', `${r.status} ${r.body.slice(0, 120)}`);
    check('odgovor je JSON i ne kešira se', /application\/json/.test(r.headers.get('content-type') ?? '') && /no-store/.test(r.headers.get('cache-control') ?? ''), `${r.headers.get('content-type')} | ${r.headers.get('cache-control')}`);
    const reads = fake.calls(isProfileRead, m);
    check('uloga se čita JWT-om samog korisnika, ne servisnim ključem', reads.length >= 2 && reads.every((x) => x.caller.kind === 'user' && x.caller.sub === L.id), JSON.stringify(reads.map((x) => x.caller)));
    check('iz profila se traži samo disabled_at (provera naloga) i role, nikad cele kolone', reads.every((x) => ['disabled_at', 'role'].includes(x.params.get('select'))), JSON.stringify(reads.map((x) => x.params.get('select'))));
    check('ruta ništa ne upisuje', fake.calls(isWrite, m).length === 0, JSON.stringify(fake.calls(isWrite, m).map((x) => x.path)));

    r = await get(app, '/api/me', { cookie: cookies.admin });
    check('admin (aal2): 200 i telo je tačno {"role":"admin"}', r.status === 200 && r.body === '{"role":"admin"}', `${r.status} ${r.body.slice(0, 120)}`);

    r = await get(app, '/api/me', { cookie: cookies.noMfa });
    check('admin bez uključenog MFA: 200 {"role":"admin"} (panel ga vodi na uključivanje)', r.status === 200 && r.body === '{"role":"admin"}', `${r.status} ${r.body.slice(0, 120)}`);

    r = await get(app, '/api/me', { cookie: cookies.adminAal1 });
    check('admin sa faktorom, a bez koda: 401 mfa_required, bez uloge', r.status === 401 && /mfa_required/.test(r.body) && !/"role"/.test(r.body), `${r.status} ${r.body.slice(0, 120)}`);

    r = await get(app, '/api/me', { cookie: cookies.blocked });
    check('blokiran admin sa važećim aal2 tokenom: 403 account_blocked, bez uloge', r.status === 403 && /account_blocked/.test(r.body) && !/"role"/.test(r.body), `${r.status} ${r.body.slice(0, 120)}`);

    r = await get(app, '/api/me', { cookie: cookies.noProfile });
    check('nalog bez profila: 200 {"role":"lawyer"}', r.status === 200 && r.body === '{"role":"lawyer"}', `${r.status} ${r.body.slice(0, 120)}`);

    // Greška drugog čitanja (prvo je provera naloga u requireUser): ruta ne sme da tvrdi ništa o ulozi
    fake.state.failures.set('select_profiles', { status: 500, code: 'XX000', message: 'tajna greška baze', after: 1 });
    r = await get(app, '/api/me', { cookie: cookies.admin });
    check('greška čitanja uloge: 500 me_failed, bez uloge i bez internog teksta', r.status === 500 && /"code":"me_failed"/.test(r.body) && !/"role"/.test(r.body) && !/tajna/.test(r.body), `${r.status} ${r.body.slice(0, 120)}`);
    fake.state.failures.clear();

    fake.state.failures.set('select_profiles', { status: 500, code: 'XX000', message: 'tajna greška baze', after: 0 });
    r = await get(app, '/api/me', { cookie: cookies.admin });
    check('greška provere naloga: 503, bez uloge', r.status === 503 && !/"role"/.test(r.body) && !/tajna/.test(r.body), `${r.status} ${r.body.slice(0, 120)}`);
    fake.state.failures.clear();

    // ---------------------------------------------------------------- HTML sa servera
    section('/chat: HTML sa servera');
    for (const [who, cookie] of [['advokat', cookies.lawyer], ['admin (aal2)', cookies.admin]]) {
      seed();
      r = await get(app, '/chat', { cookie });
      check(`${who}: HTML ne sadrži reči "Admin panel" ni vezu ka /admin (veza stiže tek posle /api/me)`, r.status === 200 && !/Admin panel/i.test(r.body) && !hrefsOf(r.body).some(isAdminPath), `${r.status}`);
      check(`${who}: HTML ima vezu "Bezbednost naloga" ka /account/security`, hrefsOf(r.body).includes('/account/security') && /Bezbednost naloga/.test(textOf(r.body)));
    }

    // ---------------------------------------------------------------- meni u pravom pregledaču
    section('Meni u pravom pregledaču (Edge preko playwright-core)');
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
      check(`pregledač se pokreće (Edge ${browser.version()})`, true);
    } catch (error) {
      check('pregledač se pokreće (Edge preko playwright-core)', false, error.message);
    }

    if (browser) {
      await scenario('advokat', cookies.lawyer, async (s) => {
        check('advokat: /api/me u pregledaču odgovara {"role":"lawyer"}', s.me?.status() === 200 && s.meBody === '{"role":"lawyer"}', `${s.me?.status()} ${s.meBody}`);
        check('advokat: u meniju nema veze ka panelu', (await adminLinks(s.page).count()) === 0);
        check('advokat: nigde na stranici nema reči "Admin panel"', !/Admin panel/i.test(await s.page.content()));
        check('advokat: meni ima vezu "Bezbednost naloga" (tačno jednu)', (await securityLink(s.page).count()) === 1);
        check('advokat: stranica nema neuhvaćenih grešaka', s.errors.length === 0, s.errors.join(' | '));
        await securityLink(s.page).click();
        await s.page.waitForURL((u) => u.pathname === '/account/security');
        check('advokat: klik na "Bezbednost naloga" otvara /account/security', new URL(s.page.url()).pathname === '/account/security', s.page.url());
      });

      await scenario('admin (aal2)', cookies.admin, async (s) => {
        const link = adminLinks(s.page);
        const visible = await appears(link);
        check('admin (aal2): /api/me u pregledaču odgovara {"role":"admin"}', s.me?.status() === 200 && s.meBody === '{"role":"admin"}', `${s.me?.status()} ${s.meBody}`);
        check('admin (aal2): u meniju je jedna veza "Admin panel" ka /admin', visible && (await link.count()) === 1 && (await link.first().getAttribute('href')) === '/admin' && /Admin panel/.test(await link.first().innerText()), `vidljiva=${visible}`);
        check('admin (aal2): meni ima i "Bezbednost naloga"', (await securityLink(s.page).count()) === 1);
        check('admin (aal2): stranica nema neuhvaćenih grešaka', s.errors.length === 0, s.errors.join(' | '));
        check('admin (aal2): dok se ne klikne, nijedan zahtev ne ide ka /admin (nema prefetch-a)', !s.requests.some(isAdminPath), JSON.stringify(s.requests.filter(isAdminPath)));
        await link.first().click();
        await s.page.waitForURL((u) => u.pathname === '/admin');
        const heading = await appears(s.page.getByRole('heading', { name: 'Pregled' }));
        check('admin (aal2): klik otvara pregled panela', new URL(s.page.url()).pathname === '/admin' && heading, s.page.url());
      });

      // admin bez MFA: veza je tu, a panel ga vodi na uključivanje dvostepene prijave
      await scenario('admin bez MFA', cookies.noMfa, async (s) => {
        check('admin bez MFA: vidi vezu "Admin panel"', await appears(adminLinks(s.page)));
        await adminLinks(s.page).first().click();
        await s.page.waitForURL((u) => u.pathname === '/account/security');
        check('admin bez MFA: klik ga vodi na /account/security?next=/admin', new URL(s.page.url()).searchParams.get('next') === '/admin', s.page.url());
      });

      // blokiran admin sa važećim tokenom: aplikacija ga odbija (403), meni ne sme da otvori ništa
      await scenario('blokiran admin', cookies.blocked, async (s) => {
        check('blokiran admin: /api/me odgovara 403, veze ka panelu nema', s.me?.status() === 403 && (await adminLinks(s.page).count()) === 0, `${s.me?.status()}`);
      });

      // /api/me ne radi (baza): meni se ne lomi i ne prikazuje vezu čak ni adminu
      await scenario('baza ne radi', cookies.admin, async (s) => {
        check('baza ne radi: /api/me ne uspeva, meni ostaje ispravan bez veze ka panelu', (s.me?.status() ?? 0) >= 500 && (await adminLinks(s.page).count()) === 0 && (await securityLink(s.page).count()) === 1, `${s.me?.status()}`);
        check('baza ne radi: stranica nema neuhvaćenih grešaka', s.errors.length === 0, s.errors.join(' | '));
      }, { failure: ['select_profiles', { status: 500, code: 'XX000', message: 'tajna greška baze', after: 0 }] });
    }
  } finally {
    if (failed > 0 && process.env.PROBE_DEBUG) console.log(`\n--- log aplikacije ---\n${app.log().slice(-3000)}`);
    await browser?.close();
    await app.stop();
    await fake.stop();
  }

  console.log(`\n${passed + failed} provera, ${passed} prošlo, ${failed} palo`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
