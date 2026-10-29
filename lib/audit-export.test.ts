import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_CSV_HEADER,
  EXPORT_MAX_ROWS,
  EXPORT_PAGE_SIZE,
  auditCsvRow,
  auditExportRows,
  exportFileName,
  isCrossSiteRequest,
  type FetchAuditPage,
} from './audit-export.ts';
import { csvCell, csvLine } from './csv.ts';
import type { ActivityRow } from './activity.ts';
import type { AuditCursor } from './audit-filter.ts';

const DOC = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
const CHAT = '9c8b7a65-1111-4222-8333-444455556666';
const USER = 'a1b2c3d4-0000-4000-8000-000000000002';

const row = (extra: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 'r1',
  user_id: USER,
  actor_email: 'ana@kancelarija.rs',
  action: 'question_asked',
  resource_type: 'chat',
  resource_id: CHAT,
  metadata: { document_ids: [DOC], sources: 3, input_tokens: 100, output_tokens: 50, embed_tokens: 10 },
  ip: '203.0.113.7',
  created_at: '2026-10-28T14:57:31.2116+00:00',
  ...extra,
});

test('granice izvoza: 50.000 redova, strane ispod uobičajenog limita Supabase API-ja od 1000 redova', () => {
  assert.equal(EXPORT_MAX_ROWS, 50_000);
  assert.ok(EXPORT_PAGE_SIZE <= 1000 && EXPORT_PAGE_SIZE > 0);
});

test('zaglavlje: tačan spisak kolona', () => {
  assert.deepEqual(AUDIT_CSV_HEADER, [
    'Vreme (Beograd)',
    'Vreme (UTC)',
    'Korisnik',
    'ID korisnika',
    'Akcija',
    'Šifra akcije',
    'Detalji',
    'Tip resursa',
    'ID resursa',
    'IP adresa',
    'Metapodaci',
  ]);
});

test('auditCsvRow: ćelije idu redom zaglavlja, vreme je beogradsko i UTC, ID-evi su puni', () => {
  const cells = auditCsvRow(row());
  assert.equal(cells.length, AUDIT_CSV_HEADER.length);
  assert.equal(cells[0], '28.10.2026. 15:57'); // 14:57 UTC = 15:57 CET (posle 25.10.)
  assert.equal(cells[1], '2026-10-28T14:57:31.211Z');
  assert.equal(cells[2], 'ana@kancelarija.rs');
  assert.equal(cells[3], USER);
  assert.equal(cells[4], 'Postavljeno pitanje');
  assert.equal(cells[5], 'question_asked');
  assert.equal(cells[6], `Razgovor: ID 9c8b7a65; Izvori: ID 3f2b8c1e; Potrošeno tokena: 160`);
  assert.equal(cells[7], 'chat');
  assert.equal(cells[8], CHAT);
  assert.equal(cells[9], '203.0.113.7');
  // Puni ID-evi izvora su u metapodacima: ko je pročitao koji dokument
  assert.deepEqual(JSON.parse(String(cells[10])), row().metadata);
});

test('auditCsvRow: nedostajuća polja daju prazne ćelije, a nepoznata akcija ostaje čitljiva', () => {
  // Proverava se prikazana ćelija: null i '' su u CSV-u isto
  const cells = auditCsvRow(row({ user_id: null, actor_email: null, resource_type: null, resource_id: null, ip: null, metadata: {} })).map(csvCell);
  assert.equal(cells[2], '');
  assert.equal(cells[3], '');
  assert.equal(cells[7], '');
  assert.equal(cells[8], '');
  assert.equal(cells[9], '');
  assert.equal(cells[10], '');

  const unknown = auditCsvRow(row({ action: 'neka_nova_akcija', metadata: null })).map(csvCell);
  assert.equal(unknown[4], 'neka_nova_akcija');
  assert.equal(unknown[5], 'neka_nova_akcija');
  assert.equal(unknown[10], '');
});

test('auditCsvRow: neispravno vreme ne ruši izvoz', () => {
  const cells = auditCsvRow(row({ created_at: 'nije datum' }));
  assert.equal(cells[0], '—');
  assert.equal(cells[1], '');
});

test('CSV injection: email koji počinje formulom dobija apostrof u izvezenom redu', () => {
  const line = csvLine(auditCsvRow(row({ actor_email: '=HYPERLINK("http://evil.example","x")@kancelarija.rs' })));
  assert.ok(line.includes(`;"'=HYPERLINK(""http://evil.example"",""x"")@kancelarija.rs";`), line);
  assert.ok(!/(^|;)=/.test(line), 'nijedna ćelija ne sme da počne sa =');
});

test('metapodaci su JSON koji počinje sa {, pa ne mogu da budu formula', () => {
  const cells = auditCsvRow(row());
  assert.ok(String(cells[10]).startsWith('{'));
});

test('exportFileName: ASCII ime sa periodom', () => {
  assert.equal(exportFileName({ fromDate: '2026-10-23', toDate: '2026-10-29' }), 'aktivnost_2026-10-23_2026-10-29.csv');
});

// --- petlja po stranicama ---

type Item = { id: string; created_at: string };
// Lažna baza sa istom semantikom kao upit: redosled (created_at, id) opadajuće, strogo ispod kursora,
// i najviše serverMax redova po odgovoru (kao max_rows u Supabase API-ju).
function fakeDatabase(items: Item[], serverMax = Infinity) {
  const sorted = [...items].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  const calls: { cursor: AuditCursor | null; limit: number }[] = [];
  const fetchPage: FetchAuditPage<Item> = async (cursor, limit) => {
    calls.push({ cursor, limit });
    const after = cursor
      ? sorted.filter((r) => r.created_at < cursor.createdAt || (r.created_at === cursor.createdAt && r.id < cursor.id))
      : sorted;
    return after.slice(0, Math.min(limit, serverMax));
  };
  return { sorted, calls, fetchPage };
}

const items = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${String(i).padStart(3, '0')}`, created_at: `2026-10-28T10:00:${String(59 - i).padStart(2, '0')}+00:00` }));

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const r of gen) out.push(r);
  return out;
}

test('auditExportRows: prolazi kroz sve strane i nastavlja od poslednjeg reda strane', async () => {
  const db = fakeDatabase(items(7));
  const out = await collect(auditExportRows(db.fetchPage, 7, 3));
  assert.deepEqual(out, db.sorted);
  assert.deepEqual(db.calls.map((c) => c.cursor?.id ?? null), [null, db.sorted[2].id, db.sorted[5].id]);
});

test('auditExportRows: ne vraća više od zadatog ukupnog broja i ne traži više nego što treba', async () => {
  const db = fakeDatabase(items(10));
  const out = await collect(auditExportRows(db.fetchPage, 5, 3));
  assert.deepEqual(out, db.sorted.slice(0, 5));
  assert.deepEqual(db.calls.map((c) => c.limit), [3, 2]);
});

test('auditExportRows: ako server vrati manje redova nego što je traženo (max_rows), izvoz ne staje pre vremena', async () => {
  const db = fakeDatabase(items(7), 2);
  const out = await collect(auditExportRows(db.fetchPage, 7, 5));
  assert.deepEqual(out, db.sorted);
});

test('auditExportRows: redovi sa istim created_at se ne preskaču ni ne dupliraju (kursor nosi i id)', async () => {
  const same = Array.from({ length: 6 }, (_, i) => ({ id: `id-${i}`, created_at: '2026-10-28T10:00:00+00:00' }));
  const db = fakeDatabase(same);
  const out = await collect(auditExportRows(db.fetchPage, 6, 2));
  assert.deepEqual(out.map((r) => r.id), db.sorted.map((r) => r.id));
  assert.equal(new Set(out.map((r) => r.id)).size, 6);
});

test('auditExportRows: prazna strana pre ukupnog broja (redovi obrisani retencijom) završava izvoz', async () => {
  const db = fakeDatabase(items(4));
  const out = await collect(auditExportRows(db.fetchPage, 100, 3));
  assert.equal(out.length, 4);
  assert.equal(db.calls.length, 3); // 3 + 1 + prazna
});

test('auditExportRows: ukupno 0 ne poziva bazu', async () => {
  const db = fakeDatabase(items(3));
  assert.deepEqual(await collect(auditExportRows(db.fetchPage, 0, 3)), []);
  assert.equal(db.calls.length, 0);
});

test('auditExportRows: strana veća od tražene se seče na ukupan broj', async () => {
  const data = items(10);
  const out = await collect(auditExportRows(async () => data, 4, 3));
  assert.equal(out.length, 4);
});

test('auditExportRows: greška pri čitanju strane se prosleđuje (izvoz ne sme tiho da se skrati)', async () => {
  const db = fakeDatabase(items(6));
  let n = 0;
  const failing: FetchAuditPage<Item> = async (cursor, limit) => {
    if (++n === 2) throw new Error('baza ne odgovara');
    return db.fetchPage(cursor, limit);
  };
  const seen: Item[] = [];
  await assert.rejects(async () => {
    for await (const r of auditExportRows(failing, 6, 3)) seen.push(r);
  }, /baza ne odgovara/);
  assert.equal(seen.length, 3);
});

test('auditExportRows: kursor se uzima iz poslednjeg reda strane (created_at i id)', async () => {
  const db = fakeDatabase(items(4));
  await collect(auditExportRows(db.fetchPage, 4, 2));
  assert.deepEqual(db.calls[1].cursor, { createdAt: db.sorted[1].created_at, id: db.sorted[1].id });
});

// --- zaštita od zahteva sa tuđeg sajta ---

test('isCrossSiteRequest: izvoz sa tuđeg sajta se odbija, a ručni otvor adrese i klik na našoj stranici prolaze', () => {
  assert.equal(isCrossSiteRequest(null), false); // starije aplikacije bez zaglavlja
  assert.equal(isCrossSiteRequest('same-origin'), false);
  assert.equal(isCrossSiteRequest('none'), false); // kucanje adrese / obeleživač
  assert.equal(isCrossSiteRequest('cross-site'), true);
  assert.equal(isCrossSiteRequest('same-site'), true); // poddomen nije naš sajt
  assert.equal(isCrossSiteRequest('nešto-čudno'), true);
});
