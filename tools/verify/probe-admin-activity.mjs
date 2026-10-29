// Proba 2.5.7 (Aktivnost + CSV izvoz) i 2.5.8 (Podešavanja) na pravom `next start` sa lažnim Supabase-om.
// Pokretanje: vidi README.md. Izlaz: jedna linija po proveri; kod izlaza je 1 ako je bilo koja pala.

import crypto from 'node:crypto';
import { createFakeSupabase, formatTs, toMicros } from './lib/fake-supabase.mjs';
import { callFormAction, get, hrefsOf, sessionCookie, startApp, textOf } from './lib/app.mjs';

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

const cookies = {
  admin: sessionCookie(A, { aal: 'aal2' }),
  adminAal1: sessionCookie(A, { aal: 'aal1' }),
  lawyer: sessionCookie(L),
  noMfa: sessionCookie(N),
  blocked: sessionCookie(B, { aal: 'aal2' }),
};

function seed(rows = []) {
  fake.reset();
  for (const u of [A, L, N, B]) fake.addUser(u);
  fake.setAuditRows(rows);
}

// Redovi za dnevnik: po 3 reda dele isto vreme (isti created_at), a susedne grupe dele milisekundu i razlikuju se u
// mikrosekundama. Kursor koji koristi JS Date ili samo created_at ovde preskače ili duplira redove.
function makeRows(n, { agoMs = 3_600_000 } = {}) {
  const base = BigInt(Date.now() - agoMs) * 1000n + 500n;
  const kinds = ['chat_created', 'question_asked', 'document_uploaded', 'limit_reached'];
  return Array.from({ length: n }, (_, i) => {
    const g = Math.floor(i / 3);
    const t = base - BigInt(Math.floor(g / 2)) * 1_000_000n - (g % 2 === 0 ? 0n : 100n);
    const byAdmin = i % 2 === 0;
    const kind = i % 4;
    return {
      id: crypto.randomUUID(),
      user_id: byAdmin ? A.id : L.id,
      actor_email: byAdmin ? A.email : L.email,
      action: kinds[kind],
      resource_type: kind === 2 ? 'document' : 'chat',
      resource_id: crypto.randomUUID(),
      metadata:
        kind === 1
          ? { sources: 1, document_ids: [crypto.randomUUID()], input_tokens: 10, output_tokens: 5 }
          : kind === 2
            ? { chunks: 4, size_bytes: 2048 }
            : kind === 3
              ? { kind: 'chat', reason: 'daily_count' }
              : {},
      ip: `10.0.${i >> 8}.${i & 255}`,
      created_at: formatTs(t),
    };
  });
}
const expectedIps = (rows) =>
  [...rows]
    .sort((a, b) => {
      const ua = toMicros(a.created_at);
      const ub = toMicros(b.created_at);
      return ua === ub ? (a.id < b.id ? 1 : -1) : ua < ub ? 1 : -1;
    })
    .map((r) => r.ip);

const pageIps = (html) => [...textOf(html).matchAll(/IP (10\.0\.\d+\.\d+)/g)].map((m) => m[1]);
const isAuditPageRead = (r) => r.method === 'GET' && r.path === '/rest/v1/audit_log';
const isAuditCount = (r) => r.method === 'HEAD' && r.path === '/rest/v1/audit_log';
const isAuditInsert = (r) => r.method === 'POST' && r.path === '/rest/v1/audit_log';
const isPanelData = (r) => r.path === '/rest/v1/audit_log' || r.path === '/rest/v1/office_settings' || r.path.startsWith('/rest/v1/rpc/admin_');
const noPanelWords = (body) => !/Admin panel|Dnevnik|Aktivnost korisnika/i.test(body) && !/<title>[^<]*Admin/i.test(body);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const inputValue = (html, name) => {
  const tag = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0];
  return tag ? /value="([^"]*)"/.exec(tag)?.[1] : undefined;
};

async function readAll(res) {
  const reader = res.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return chunks;
}

async function main() {
  await fake.start();
  const app = await startApp({ port: 3111, env: { DAILY_MESSAGE_LIMIT: '50' } });
  const exportUrl = '/api/admin/audit/export';

  try {
    // ---------------------------------------------------------------- pristup
    for (const page of ['/admin/activity', '/admin/settings']) {
      section(`Pristup ${page}`);
      seed(makeRows(5));
      let m = fake.mark();
      let r = await get(app, page);
      check(`${page}: odjavljen -> /login`, r.status === 307 && r.location?.endsWith('/login'), `${r.status} ${r.location}`);

      m = fake.mark();
      r = await get(app, page, { cookie: cookies.lawyer });
      check(`${page}: advokat dobija 404`, r.status === 404, r.status);
      check(`${page}: 404 ne otkriva panel (tekst ni naslov taba)`, noPanelWords(r.body));
      check(`${page}: advokatu se ne čita nijedna tabela ni funkcija panela`, fake.calls(isPanelData, m).length === 0, JSON.stringify(fake.calls(isPanelData, m).map((x) => x.path)));

      m = fake.mark();
      r = await get(app, page, { cookie: cookies.noMfa });
      // Layout se izvršava pre stranice i ne vidi putanju, pa uvek šalje next=/admin (poznato od 2.5.5)
      check(`${page}: admin bez faktora -> /account/security?next=/admin`, r.status === 307 && r.location?.includes('/account/security?next=%2Fadmin'), `${r.status} ${r.location}`);
      check(`${page}: admin bez faktora ne čita podatke panela`, fake.calls(isPanelData, m).length === 0);

      r = await get(app, page, { cookie: cookies.adminAal1 });
      check(`${page}: admin sa faktorom, a bez koda -> /login/mfa`, r.status === 307 && r.location?.includes('/login/mfa'), `${r.status} ${r.location}`);

      m = fake.mark();
      r = await get(app, page, { cookie: cookies.blocked });
      check(`${page}: blokiran admin sa važećim aal2 tokenom dobija 404`, r.status === 404, r.status);
      check(`${page}: blokiran admin ne čita podatke panela`, fake.calls(isPanelData, m).length === 0);
    }

    // ---------------------------------------------------------------- aktivnost: stranica
    section('Aktivnost: stranica');
    const rows120 = makeRows(120);
    seed(rows120);
    let m = fake.mark();
    let r = await get(app, '/admin/activity', { cookie: cookies.admin });
    check('admin sa aal2 otvara stranicu (200)', r.status === 200, r.status);
    const text = textOf(r.body);
    check('naslov i opis', /Aktivnost/.test(text) && /90 dana/.test(text));
    check('nema naslova taba koji otkriva panel', !/<title>[^<]*Admin/i.test(r.body));
    check('navigacija panela ima Aktivnost i Podešavanja', hrefsOf(r.body).includes('/admin/activity') && hrefsOf(r.body).includes('/admin/settings'));
    const reads = fake.calls(isAuditPageRead, m);
    check('čita audit_log tačno jednom', reads.length === 1, reads.length);
    const read = reads[0];
    check('čitanje nosi JWT admina sa aal2, nikad servisni ključ', read?.caller.kind === 'user' && read.caller.sub === A.id && read.caller.aal === 'aal2', JSON.stringify(read?.caller));
    check('51 red (strana + 1 za proveru sledeće)', read?.params.get('limit') === '51', read?.params.get('limit'));
    check('redosled created_at opadajuće, pa id opadajuće', read?.params.get('order') === 'created_at.desc,id.desc', read?.params.get('order'));
    const [gte, lt] = [read?.params.getAll('created_at').find((v) => v.startsWith('gte.')), read?.params.getAll('created_at').find((v) => v.startsWith('lt.'))];
    const spanH = gte && lt ? (Date.parse(lt.slice(3)) - Date.parse(gte.slice(4))) / 3_600_000 : NaN;
    check('podrazumevani period: granice su beogradska ponoć (22:00 ili 23:00 UTC)', /T(22|23):00:00\.000Z$/.test(gte ?? '') && /T(22|23):00:00\.000Z$/.test(lt ?? ''), `${gte} ${lt}`);
    check('podrazumevani period traje 7 dana (±1 sat zbog prelaza sata)', Math.abs(spanH - 168) <= 1, spanH);
    check('nije poslat filter po advokatu ni akciji', !read?.params.has('user_id') && !read?.params.has('action'));
    check('stranica poziva admin_list_users za spisak advokata', fake.calls((x) => x.path.endsWith('/rpc/admin_list_users'), m).length === 1);
    check('prikazuje tačno 50 zapisa', pageIps(r.body).length === 50, pageIps(r.body).length);
    check('zapisi su u ispravnom redosledu (vreme, pa id)', JSON.stringify(pageIps(r.body)) === JSON.stringify(expectedIps(rows120).slice(0, 50)));
    check('prikazuje email korisnika i opis akcije na srpskom', /admin@kancelarija\.rs/.test(text) && /Započet razgovor|Postavljeno pitanje/.test(text));
    check('zapisi koji traže pažnju imaju svoju boju', /text-amber-700[^>]*>Dostignut limit/.test(r.body));

    // ---------------------------------------------------------------- filteri
    section('Aktivnost: filteri i neispravan unos');
    m = fake.mark();
    r = await get(app, `/admin/activity?user=${L.id}&action=question_asked&from=2026-03-29&to=2026-03-29`, { cookie: cookies.admin });
    const f = fake.calls(isAuditPageRead, m)[0];
    check('filter po advokatu i akciji ide u upit', f?.params.get('user_id') === `eq.${L.id}` && f?.params.get('action') === 'eq.question_asked', f?.search);
    check('29.3.2026. (dan od 23 sata): granice su ručno izvedene', f?.params.getAll('created_at').includes('gte.2026-03-28T23:00:00.000Z') && f?.params.getAll('created_at').includes('lt.2026-03-29T22:00:00.000Z'), JSON.stringify(f?.params.getAll('created_at')));
    check('forma ima izabranog advokata i akciju', new RegExp(`<option[^>]*value="${L.id}"[^>]*selected`).test(r.body) || new RegExp(`<option[^>]*selected[^>]*value="${L.id}"`).test(r.body));

    m = fake.mark();
    r = await get(app, '/admin/activity?from=2026-10-25&to=2026-10-25', { cookie: cookies.admin });
    const f2 = fake.calls(isAuditPageRead, m)[0];
    check('25.10.2026. (dan od 25 sati): granice su ručno izvedene', f2?.params.getAll('created_at').includes('gte.2026-10-24T22:00:00.000Z') && f2?.params.getAll('created_at').includes('lt.2026-10-25T23:00:00.000Z'), JSON.stringify(f2?.params.getAll('created_at')));

    for (const [label, query, expected] of [
      ['nepostojeći datum', 'from=2026-02-30', /datum/i],
      ['period duži od 90 dana', 'from=2026-06-01&to=2026-10-29', /90/],
      ['početak posle kraja', 'from=2026-10-20&to=2026-10-19', /početak/i],
      ['nepoznata vrsta', 'action=izmisljeno', /vrst/i],
      ['neispravan advokat', 'user=nije-uuid', /advokat/i],
      ['pokvaren kursor', 'cursor=x%22),id.neq.1', /strana/i],
    ]) {
      m = fake.mark();
      r = await get(app, `/admin/activity?${query}`, { cookie: cookies.admin });
      check(`${label}: poruka na stranici, bez upita u bazu`, r.status === 200 && expected.test(textOf(r.body)) && fake.calls(isAuditPageRead, m).length === 0, `${r.status} ${fake.calls(isAuditPageRead, m).length}`);
    }

    m = fake.mark();
    seed(rows120);
    fake.state.failures.set('select_audit', { status: 500, code: 'XX000', message: 'interna greška: relation "audit_log" tajna' });
    r = await get(app, '/admin/activity', { cookie: cookies.admin });
    check('greška baze: poruka bez internog teksta', r.status === 200 && /Greška pri učitavanju/.test(textOf(r.body)) && !/tajna|relation/.test(r.body), r.status);

    // ---------------------------------------------------------------- paginacija
    section('Aktivnost: paginacija po kursoru (created_at, id)');
    seed(rows120);
    const order = expectedIps(rows120);
    const p1 = await get(app, '/admin/activity', { cookie: cookies.admin });
    const next1 = hrefsOf(p1.body).find((h) => h.startsWith('/admin/activity?') && h.includes('cursor='));
    check('prva strana ima vezu "Starije" sa kursorom, a nema "Na početak"', Boolean(next1) && !/Na početak/.test(textOf(p1.body)));
    check('veza čuva izričit period (ne podrazumevani)', /from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/.test(next1 ?? ''), next1);
    const cursor1 = new URLSearchParams(next1?.split('?')[1]).get('cursor') ?? '';
    check('kursor ima mikrosekunde (ne zaokružuje se na milisekunde)', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{4,6}\+00:00_[0-9a-f-]{36}$/.test(cursor1), cursor1);

    m = fake.mark();
    const p2 = await get(app, next1, { cookie: cookies.admin });
    const q2 = fake.calls(isAuditPageRead, m)[0];
    const orParam = q2?.params.get('or') ?? '';
    check('upit druge strane: vreme u or=(...) je pod navodnicima', /^\(created_at\.lt\."[^"]+",and\(created_at\.eq\."[^"]+",id\.lt\.[0-9a-f-]{36}\)\)$/.test(orParam), orParam);
    check('druga strana: sledećih 50 redova, bez preskočenih i dupliranih', JSON.stringify(pageIps(p2.body)) === JSON.stringify(order.slice(50, 100)), pageIps(p2.body).slice(0, 4).join(','));
    const next2 = hrefsOf(p2.body).find((h) => h.startsWith('/admin/activity?') && h.includes('cursor='));
    check('druga strana ima "Starije" i "Na početak"', Boolean(next2) && /Na početak/.test(textOf(p2.body)));
    const p3 = await get(app, next2, { cookie: cookies.admin });
    check('treća strana: preostalih 20 redova i nema "Starije"', JSON.stringify(pageIps(p3.body)) === JSON.stringify(order.slice(100)) && !hrefsOf(p3.body).some((h) => h.includes('cursor=')), `${pageIps(p3.body).length}`);
    const all = [...pageIps(p1.body), ...pageIps(p2.body), ...pageIps(p3.body)];
    check('tri strane zajedno: svih 120 redova tačno jednom', all.length === 120 && new Set(all).size === 120 && JSON.stringify(all) === JSON.stringify(order));

    // ---------------------------------------------------------------- izvoz: pristup
    section('CSV izvoz: pristup');
    seed(makeRows(5));
    m = fake.mark();
    r = await get(app, exportUrl);
    check('odjavljen: preusmerenje na prijavu, bez podataka', r.status === 307 && fake.calls((x) => isAuditPageRead(x) || isAuditInsert(x), m).length === 0, `${r.status}`);
    r = await get(app, exportUrl, { cookie: cookies.lawyer });
    check('advokat: 404 (ruta ne otkriva da postoji), bez upisa i čitanja', r.status === 404 && fake.calls((x) => isAuditPageRead(x) || isAuditInsert(x), m).length === 0, `${r.status} ${r.body.slice(0, 120)}`);
    r = await get(app, exportUrl, { cookie: cookies.noMfa });
    check('admin bez faktora: 403 mfa_required, bez čitanja', r.status === 403 && /mfa_required/.test(r.body) && fake.calls((x) => isAuditPageRead(x) || isAuditInsert(x), m).length === 0, `${r.status} ${r.body.slice(0, 120)}`);
    r = await get(app, exportUrl, { cookie: cookies.adminAal1 });
    check('admin sa faktorom bez koda: 401 mfa_required (kapija), bez čitanja', r.status === 401 && /mfa_required/.test(r.body) && fake.calls((x) => isAuditPageRead(x) || isAuditInsert(x), m).length === 0, `${r.status} ${r.body.slice(0, 120)}`);
    r = await get(app, exportUrl, { cookie: cookies.blocked });
    check('blokiran admin: 404, bez čitanja', r.status === 404 && fake.calls((x) => isAuditPageRead(x) || isAuditInsert(x), m).length === 0, `${r.status}`);
    r = await get(app, exportUrl, { cookie: cookies.admin, headers: { 'Sec-Fetch-Site': 'cross-site' } });
    check('zahtev sa tuđeg sajta: 403, bez upisa i čitanja', r.status === 403 && fake.calls((x) => isAuditPageRead(x) || isAuditInsert(x), m).length === 0, `${r.status} ${r.body.slice(0, 120)}`);
    r = await get(app, exportUrl, { cookie: cookies.admin, headers: { 'Sec-Fetch-Site': 'same-origin' } });
    check('zahtev sa našeg sajta prolazi', r.status === 200, r.status);

    // ---------------------------------------------------------------- izvoz: sadržaj
    section('CSV izvoz: sadržaj i zaglavlja');
    const special = makeRows(6);
    special[0].actor_email = '=HYPERLINK("http://evil.example","x")@kancelarija.rs';
    special[1].action = 'chat_created'; // "Započet razgovor" ima č
    special[2].metadata = { note: 'tačka;zarez "navodnik"' };
    seed(special);
    m = fake.mark();
    r = await get(app, exportUrl, { cookie: cookies.admin });
    check('200 i text/csv; charset=utf-8', r.status === 200 && /^text\/csv; charset=utf-8$/i.test(r.headers.get('content-type') ?? ''), `${r.status} ${r.headers.get('content-type')}`);
    check('Content-Disposition: attachment sa ASCII imenom aktivnost_<od>_<do>.csv', /^attachment; filename="aktivnost_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/.test(r.headers.get('content-disposition') ?? ''), r.headers.get('content-disposition'));
    check('Cache-Control: no-store i nosniff', /no-store/.test(r.headers.get('cache-control') ?? '') && r.headers.get('x-content-type-options') === 'nosniff');
    check('telo počinje UTF-8 BOM-om (bajtovi EF BB BF)', r.raw[0] === 0xef && r.raw[1] === 0xbb && r.raw[2] === 0xbf, r.raw.subarray(0, 4).toString('hex'));
    const csv = parseCsv(r.body.slice(1));
    check('zaglavlje: 11 kolona na srpskom', csv[0]?.length === 11 && csv[0][0] === 'Vreme (Beograd)' && csv[0][10] === 'Metapodaci', JSON.stringify(csv[0]));
    check('6 redova podataka + zaglavlje, svaki ima 11 ćelija', csv.length === 7 && csv.every((row) => row.length === 11), `${csv.length}`);
    check('redosled isti kao na stranici (vreme, pa id)', JSON.stringify(csv.slice(1).map((row) => row[9])) === JSON.stringify(expectedIps(special)));
    check('slova č ć š ž đ ostaju ispravna (UTF-8)', /Započet razgovor/.test(r.body));
    const evilRow = csv.find((row) => row[9] === special[0].ip);
    check('CSV injection: email koji počinje sa = dobija apostrof', evilRow?.[2]?.startsWith("'=HYPERLINK("), evilRow?.[2]);
    check('nijedna ćelija ne počinje formulom', csv.slice(1).every((row) => row.every((cell) => !/^[=+@\t\r]/.test(cell))));
    const metaRow = csv.find((row) => row[9] === special[2].ip);
    check('metapodaci sa ; i navodnicima ostaju jedna ćelija (JSON)', metaRow?.[10] === JSON.stringify(special[2].metadata), metaRow?.[10]);
    check('CSV nema sadržaj pitanja ni odgovora (samo oznake i brojevi)', !/tekst pitanja|odgovor/i.test(r.body));

    const inserts = fake.calls(isAuditInsert, m);
    const exportedInsert = inserts.find((x) => x.body?.action === 'audit_exported');
    check('upisan je tačno jedan audit_exported', inserts.length === 1 && Boolean(exportedInsert), JSON.stringify(inserts.map((x) => x.body)));
    check('audit upis ide servisnim ključem, a korisnik je admin', exportedInsert?.caller.kind === 'service' && exportedInsert?.body.user_id === A.id && exportedInsert?.body.actor_email === A.email);
    check('audit metadata: broj redova i period, bez sadržaja', exportedInsert?.body.metadata.rows === 6 && exportedInsert.body.metadata.truncated === false && /^\d{4}-\d{2}-\d{2}$/.test(exportedInsert.body.metadata.from), JSON.stringify(exportedInsert?.body.metadata));
    const firstPage = fake.calls(isAuditPageRead, m)[0];
    check('audit_exported je upisan PRE prve strane podataka', exportedInsert && firstPage && exportedInsert.n < firstPage.n, `${exportedInsert?.n} ${firstPage?.n}`);
    const countCall = fake.calls(isAuditCount, m)[0];
    check('broj redova se prebrojava jednim upitom pre upisa i nosi JWT admina', countCall && countCall.n < exportedInsert.n && countCall.caller.kind === 'user' && countCall.caller.aal === 'aal2', JSON.stringify(countCall?.caller));
    check('sva čitanja podataka nose JWT admina (nikad servisni ključ)', fake.calls(isAuditPageRead, m).every((x) => x.caller.kind === 'user' && x.caller.sub === A.id));

    // ---------------------------------------------------------------- izvoz: filteri
    section('CSV izvoz: filteri');
    seed(makeRows(8));
    m = fake.mark();
    r = await get(app, `${exportUrl}?user=${L.id}&action=question_asked&from=2026-10-01&to=2026-10-29`, { cookie: cookies.admin });
    const fp = fake.calls(isAuditPageRead, m)[0];
    check('filteri iz URL-a stižu do upita (advokat, akcija, period)', fp?.params.get('user_id') === `eq.${L.id}` && fp?.params.get('action') === 'eq.question_asked' && fp.params.getAll('created_at').some((v) => v === 'gte.2026-09-30T22:00:00.000Z'), fp?.search);
    check('ime fajla nosi period', /aktivnost_2026-10-01_2026-10-29\.csv/.test(r.headers.get('content-disposition') ?? ''));
    const ex = fake.calls(isAuditInsert, m)[0];
    check('audit_exported pamti filtere', ex?.body.metadata.user === L.id && ex?.body.metadata.action === 'question_asked' && ex?.body.metadata.from === '2026-10-01' && ex?.body.metadata.to === '2026-10-29', JSON.stringify(ex?.body.metadata));
    const until = fp?.params.getAll('created_at').find((v) => v.startsWith('lt.'));
    check('gornja granica je zamrznuta na početak izvoza (ne ponoć sutra), pa se broj redova ne menja u toku izvoza', Boolean(until) && Date.parse(until.slice(3)) <= Date.now() + 1000 && Date.parse(until.slice(3)) > Date.now() - 60_000, until);

    for (const [label, query] of [
      ['neispravan datum', 'from=2026-02-30'],
      ['period duži od 90 dana', 'from=2026-06-01&to=2026-10-29'],
      ['nepoznata akcija', 'action=izmisljeno'],
      ['neispravan advokat', 'user=nije-uuid'],
    ]) {
      m = fake.mark();
      r = await get(app, `${exportUrl}?${query}`, { cookie: cookies.admin });
      check(`${label}: 400 {error, code}, bez upisa i čitanja`, r.status === 400 && /"code":"invalid_filter"/.test(r.body) && fake.calls((x) => isAuditPageRead(x) || isAuditInsert(x) || isAuditCount(x), m).length === 0, `${r.status} ${r.body.slice(0, 160)}`);
    }

    // ---------------------------------------------------------------- izvoz: velike količine i greške
    section('CSV izvoz: više od 1000 redova (max_rows), strim, ograničenje i greške');
    const rows1300 = makeRows(1300);
    seed(rows1300);
    m = fake.mark();
    r = await get(app, exportUrl, { cookie: cookies.admin });
    const csv1300 = parseCsv(r.body.slice(1));
    check('1300 redova (iznad max_rows 1000): svi, tačno jednom, istim redosledom', csv1300.length === 1301 && JSON.stringify(csv1300.slice(1).map((x) => x[9])) === JSON.stringify(expectedIps(rows1300)));
    const pageReads = fake.calls(isAuditPageRead, m);
    check('čitanje ide u stranama (više upita, svaki do 500 redova)', pageReads.length >= 3 && pageReads.every((x) => Number(x.params.get('limit')) <= 500), pageReads.map((x) => x.params.get('limit')).join(','));
    check('sve strane čitaju isti period (zamrznuta gornja granica)', new Set(pageReads.map((x) => JSON.stringify(x.params.getAll('created_at')))).size === 1);

    seed(makeRows(5000));
    fake.state.pageDelayMs = 40;
    m = fake.mark();
    const t0 = Date.now();
    const res = await fetch(`${app.base}${exportUrl}`, { headers: { cookie: cookies.admin, 'Accept-Encoding': 'identity' } });
    const reader = res.body.getReader();
    const first = await reader.read();
    let second = await reader.read();
    const readsAtSecondChunk = fake.calls(isAuditPageRead, m).length;
    let chunks = 2;
    let bytes = first.value.length + (second.value?.length ?? 0);
    while (!second.done) {
      second = await reader.read();
      if (!second.done) {
        chunks++;
        bytes += second.value.length;
      }
    }
    const readsTotal = fake.calls(isAuditPageRead, m).length;
    check('strim: odgovor stiže u više delova', chunks > 5, `${chunks} delova, ${bytes} B`);
    check('strim: prvi deo podataka stiže pre nego što su pročitane sve strane iz baze', readsAtSecondChunk < readsTotal && readsAtSecondChunk <= 3, `${readsAtSecondChunk} od ${readsTotal} u trenutku drugog dela, ${Date.now() - t0} ms`);
    fake.state.pageDelayMs = 0;

    const rows50k = makeRows(50_500);
    seed(rows50k);
    m = fake.mark();
    r = await get(app, exportUrl, { cookie: cookies.admin });
    const csv50k = parseCsv(r.body.slice(1));
    const cap = fake.calls(isAuditInsert, m)[0];
    check('50.500 redova: izvezeno najviše 50.000 + zaglavlje', csv50k.length === 50_001, csv50k.length);
    check('izvezeno je 50.000 NAJNOVIJIH redova', JSON.stringify(csv50k.slice(1, 4).map((x) => x[9])) === JSON.stringify(expectedIps(rows50k).slice(0, 3)) && csv50k.at(-1)[9] === expectedIps(rows50k)[49_999]);
    check('audit_exported: rows 50000 i truncated true', cap?.body.metadata.rows === 50_000 && cap.body.metadata.truncated === true, JSON.stringify(cap?.body.metadata));

    seed([]);
    m = fake.mark();
    r = await get(app, exportUrl, { cookie: cookies.admin });
    check('0 redova: CSV samo sa zaglavljem, audit rows 0', r.status === 200 && parseCsv(r.body.slice(1)).length === 1 && fake.calls(isAuditInsert, m)[0]?.body.metadata.rows === 0, `${r.status}`);

    seed(makeRows(3000));
    fake.state.failures.set('insert_audit', { status: 500, code: 'XX000', message: 'tajna greška upisa' });
    m = fake.mark();
    r = await get(app, exportUrl, { cookie: cookies.admin });
    check('upis u audit ne uspeva: izvoz se NE šalje (500 audit_failed), nijedna strana podataka nije pročitana', r.status === 500 && /audit_failed/.test(r.body) && fake.calls(isAuditPageRead, m).length === 0 && !/tajna/.test(r.body), `${r.status} ${r.body.slice(0, 160)}`);

    seed(makeRows(3000));
    fake.state.failures.set('select_audit_count', { status: 500, code: 'XX000', message: 'tajna greška brojanja' });
    m = fake.mark();
    r = await get(app, exportUrl, { cookie: cookies.admin });
    check('brojanje ne uspeva: 500, bez audit zapisa i bez podataka', r.status === 500 && fake.calls((x) => isAuditInsert(x) || isAuditPageRead(x), m).length === 0 && !/tajna/.test(r.body), `${r.status} ${r.body.slice(0, 160)}`);

    seed(makeRows(3000));
    fake.state.failures.set('select_audit', { status: 500, code: 'XX000', message: 'tajna greška strane', after: 2 });
    let failure = null;
    let partial = 0;
    try {
      const res2 = await fetch(`${app.base}${exportUrl}`, { headers: { cookie: cookies.admin, 'Accept-Encoding': 'identity' } });
      const reader2 = res2.body.getReader();
      for (;;) {
        const { done, value } = await reader2.read();
        if (done) break;
        partial += value.length;
      }
    } catch (error) {
      failure = error;
    }
    check('greška usred izvoza: preuzimanje puca (fajl ne izgleda potpun)', failure !== null && partial > 0, failure ? `${failure.name}: ${failure.message}` : 'preuzimanje je završilo bez greške');
    fake.state.failures.clear();

    // ---------------------------------------------------------------- podešavanja
    section('Podešavanja: stranica');
    seed([]);
    m = fake.mark();
    r = await get(app, '/admin/settings', { cookie: cookies.admin });
    const st = textOf(r.body);
    check('admin sa aal2 otvara stranicu (200)', r.status === 200, r.status);
    check('četiri polja sa trenutnim vrednostima iz baze', inputValue(r.body, 'dailyMessages') === '100' && inputValue(r.body, 'dailyDocuments') === '20' && inputValue(r.body, 'dailyTokens') === '1000000' && inputValue(r.body, 'monthlyTokens') === '20000000', [ 'dailyMessages', 'dailyDocuments', 'dailyTokens', 'monthlyTokens' ].map((k) => `${k}=${inputValue(r.body, k)}`).join(' '));
    check('env granica 50 (DAILY_MESSAGE_LIMIT) skraćuje vrednost 100: napomena', /Važi gornja granica ugovora: 50/.test(st), st.slice(0, 400));
    check('napomena postoji samo za polje kome granica smeta', (st.match(/Važi gornja granica ugovora/g) ?? []).length === 1);
    check('čita office_settings preko korisničkog klijenta (JWT admina)', fake.calls((x) => x.path === '/rest/v1/office_settings', m).every((x) => x.caller.kind === 'user' && x.caller.sub === A.id));
    check('navodi kad promena važi', /odmah/i.test(st));

    section('Podešavanja: snimanje (server akcija)');
    const call = (cookie, fields) => callFormAction(app, { exportedName: 'updateSettings', page: 'app/admin/settings/page', cookie, fields });
    const good = { dailyMessages: '80', dailyDocuments: '15', dailyTokens: '900000', monthlyTokens: '18000000' };
    const rpcCalls = (from) => fake.calls((x) => x.path === '/rest/v1/rpc/admin_update_settings', from);

    m = fake.mark();
    let a = await call(cookies.admin, good);
    check('ispravne vrednosti: uspeh', a.status === 200 && /Podešavanja su sačuvana/.test(a.body), `${a.status} ${a.body.slice(0, 300)}`);
    const rc = rpcCalls(m);
    check('poziva admin_update_settings tačno jednom sa tačnim parametrima', rc.length === 1 && JSON.stringify(rc[0].body) === JSON.stringify({ p_daily_message_limit: 80, p_daily_document_limit: 15, p_daily_token_budget: 900000, p_monthly_token_budget: 18000000 }), JSON.stringify(rc.map((x) => x.body)));
    check('RPC nosi JWT admina sa aal2, ne servisni ključ', rc[0]?.caller.kind === 'user' && rc[0].caller.sub === A.id && rc[0].caller.aal === 'aal2', JSON.stringify(rc[0]?.caller));
    check('baza je promenjena, a audit settings_changed upisuje baza (ne aplikacija)', fake.state.settings.daily_message_limit === 80 && fake.calls(isAuditInsert, m).length === 0 && fake.state.auditRows.some((x) => x.action === 'settings_changed'));
    r = await get(app, '/admin/settings', { cookie: cookies.admin });
    check('promena je odmah vidljiva na stranici', inputValue(r.body, 'dailyMessages') === '80' && inputValue(r.body, 'monthlyTokens') === '18000000');

    m = fake.mark();
    a = await call(cookies.admin, good);
    check('iste vrednosti: "Nema promena", RPC se ne poziva (nema lažnog audit zapisa)', /Nema promena/.test(a.body) && rpcCalls(m).length === 0, a.body.slice(0, 300));

    for (const [label, fields, expected] of [
      ['mesečni budžet manji od dnevnog', { ...good, dailyTokens: '900000', monthlyTokens: '1000' }, /Mesečni budžet ne može biti manji od dnevnog/],
      ['tekst umesto broja', { ...good, dailyMessages: 'abc' }, /ceo broj/],
      ['decimalni broj', { ...good, dailyDocuments: '1.5' }, /ceo broj/],
      ['negativan broj', { ...good, dailyMessages: '-5' }, /ceo broj/],
      ['poruka iznad 10000', { ...good, dailyMessages: '10001' }, /od 1 do 10000/],
      ['prazno polje', { ...good, dailyTokens: '' }, /ceo broj/],
    ]) {
      m = fake.mark();
      a = await call(cookies.admin, fields);
      check(`${label}: poruka, bez poziva baze`, a.status === 200 && expected.test(a.body) && rpcCalls(m).length === 0, `${a.status} ${a.body.slice(0, 300)}`);
    }
    m = fake.mark();
    a = await call(cookies.admin, { ...good, dailyMessages: 'abc' });
    check('posle greške stanje nosi unete vrednosti (forma ih vraća)', /"dailyMessages":"abc"/.test(a.body), a.body.slice(0, 400));

    for (const [label, cookie] of [
      ['odjavljen', undefined],
      ['advokat', cookies.lawyer],
      ['admin bez uključenog MFA (prolazi kapiju, mora ga zaustaviti sama akcija)', cookies.noMfa],
      ['admin sa faktorom bez koda (aal1)', cookies.adminAal1],
      ['blokiran admin sa važećim aal2 tokenom', cookies.blocked],
    ]) {
      m = fake.mark();
      a = await call(cookie, { ...good, dailyMessages: '7' });
      check(`akcija odbija: ${label}`, rpcCalls(m).length === 0 && !/Podešavanja su sačuvana/.test(a.body) && fake.state.settings.daily_message_limit === 80, `${a.status} ${a.body.slice(0, 200)}`);
    }

    for (const [code, expected] of [
      ['23514', /van dozvoljenog opsega/],
      ['42501', /Nemate dozvolu/],
      ['XX000', /nije uspelo/],
    ]) {
      fake.state.failures.set('rpc_admin_update_settings', { status: 400, code, message: `interni tekst ${code} tajna` });
      a = await call(cookies.admin, { ...good, dailyMessages: '60' });
      check(`greška baze ${code}: poruka na srpskom, bez internog teksta`, expected.test(a.body) && !/tajna/.test(a.body), a.body.slice(0, 300));
    }
    fake.state.failures.clear();

    // ---------------------------------------------------------------- regresije
    section('Regresije postojećih stranica');
    seed(makeRows(10));
    r = await get(app, '/activity', { cookie: cookies.lawyer });
    check('/activity (advokat): 200, vidi samo svoje', r.status === 200 && pageIps(r.body).length === 5 && /Pregled vaših aktivnosti/.test(textOf(r.body)), `${r.status} ${pageIps(r.body).length}`);
    check('/activity: zapisi koji traže pažnju i dalje imaju svoju boju', /text-amber-700[^>]*>Dostignut limit/.test(r.body));
    r = await get(app, '/admin', { cookie: cookies.admin });
    check('/admin (pregled): 200 sa novom navigacijom', r.status === 200 && hrefsOf(r.body).includes('/admin/activity') && hrefsOf(r.body).includes('/admin/settings'), `${r.status}`);
    r = await get(app, '/admin/users', { cookie: cookies.admin });
    check('/admin/users: 200', r.status === 200, `${r.status}`);
  } finally {
    if (failed > 0 && process.env.PROBE_DEBUG) console.log(`
--- log aplikacije ---
${app.log().slice(-3000)}`);
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
