import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page';
import {
  ACTION_LABELS,
  ACTIVITY_ACTIONS,
  ATTENTION_ACTIONS,
  PAGE_SIZE,
  describeActivity,
  formatBelgrade,
  type ActivityRow,
} from '@/lib/activity';
import {
  AUDIT_MAX_DAYS,
  auditFilterParams,
  defaultAuditFilter,
  encodeCursor,
  parseAuditFilter,
  parseCursor,
  type AuditFilter,
} from '@/lib/audit-filter';
import { auditPageQuery } from '@/lib/audit-query';
import { EXPORT_MAX_ROWS } from '@/lib/audit-export';
import { addDays, belgradeDateOf } from '@/lib/belgrade-time';
import { displayName, formatNumber, parseAdminUsers } from '@/lib/admin-overview';

// Bez `export const metadata` (kao ni ostale stranice panela): naslov taba bi otkrio da panel postoji.

const INPUT = 'rounded border border-[#16263D]/20 bg-white px-3 py-2 text-sm text-[#16263D] focus:outline-none focus:ring-2 focus:ring-[#16263D]/30';
const NO_TITLES: ReadonlyMap<string, string> = new Map(); // audit ne čuva nazive dokumenata (odluka 2.5)

function pageHref(filter: AuditFilter, cursor?: string) {
  const params = auditFilterParams(filter);
  if (cursor) params.set('cursor', cursor);
  return `/admin/activity?${params.toString()}`;
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Prvo pristup, pa tek onda obrada ulaza iz URL-a
  const { supabase } = await requireAdminPage('/admin/activity');

  const now = new Date();
  const parsed = parseAuditFilter(await searchParams, now);
  // Neispravan filter: poruka i forma sa podrazumevanim periodom, bez upita u bazu
  const filter = parsed.ok ? parsed.filter : defaultAuditFilter(now);

  // Čitanja idu preko korisničkog klijenta (JWT + RLS); admin_list_users() i RLS sami traže admina + aal2
  const [rowsResult, usersResult] = await Promise.all([
    parsed.ok ? auditPageQuery(supabase, filter, PAGE_SIZE + 1) : Promise.resolve(null),
    supabase.rpc('admin_list_users'),
  ]);

  if (rowsResult?.error) console.error('Admin Activity Error:', rowsResult.error);
  if (usersResult.error) console.error('Admin Activity Users Error:', usersResult.error);

  const loadFailed = Boolean(rowsResult?.error);
  const fetched = (rowsResult?.data ?? []) as ActivityRow[];
  const rows = fetched.slice(0, PAGE_SIZE);
  const hasNext = fetched.length > PAGE_SIZE;
  const users = usersResult.error ? null : parseAdminUsers(usersResult.data);
  const last = rows.at(-1);
  const nextCursor = last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
  // Kursor koji sam ne bi prošao proveru oblika ne sme da se pretvori u vezu koja vodi na grešku
  const nextHref = hasNext && nextCursor && parseCursor(nextCursor) ? pageHref(filter, nextCursor) : null;

  const today = belgradeDateOf(now);
  const exportHref = `/api/admin/audit/export?${auditFilterParams(filter).toString()}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#16263D]">Aktivnost</h1>
        <p className="text-sm text-[#16263D]/60 mt-1">Pregled aktivnosti svih korisnika kancelarije.</p>
        <p className="text-xs text-[#16263D]/50 mt-1">
          Beleže se samo radnje (ko, kada, šta). Tekst pitanja, odgovora i dokumenata se ne čuva, a nazivi dokumenata ni u dnevniku (prikazuje se
          skraćen ID; puni ID-evi su u CSV izvozu). Zapisi se brišu posle {AUDIT_MAX_DAYS} dana. Vreme je beogradsko.
        </p>
      </div>

      <form method="get" action="/admin/activity" className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto_auto] md:items-end">
          <label className="block text-sm text-[#16263D]">
            Advokat
            <select name="user" defaultValue={filter.userId ?? ''} className={`mt-1 w-full ${INPUT}`}>
              <option value="">Svi</option>
              {(users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[#16263D]">
            Vrsta aktivnosti
            <select name="action" defaultValue={filter.action ?? ''} className={`mt-1 w-full ${INPUT}`}>
              <option value="">Sve</option>
              {ACTIVITY_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[#16263D]">
            Od
            <input type="date" name="from" defaultValue={filter.fromDate} min={addDays(today, -(AUDIT_MAX_DAYS - 1))} max={today} className={`mt-1 w-full ${INPUT}`} />
          </label>
          <label className="block text-sm text-[#16263D]">
            Do
            <input type="date" name="to" defaultValue={filter.toDate} min={addDays(today, -(AUDIT_MAX_DAYS - 1))} max={today} className={`mt-1 w-full ${INPUT}`} />
          </label>
          <button
            type="submit"
            className="rounded bg-[#16263D] px-4 py-2 text-sm font-medium text-[#F7F3EC] hover:bg-[#16263D]/90 transition"
          >
            Primeni
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-xs text-[#16263D]/50">
          <span>Period najviše {AUDIT_MAX_DAYS} dana. Bez izbora prikazuje se poslednjih 7 dana.</span>
          <span className="flex items-center gap-3">
            <Link href="/admin/activity" className="text-blue-600 hover:text-blue-800 font-medium">
              Poništi filtere
            </Link>
            {parsed.ok && (
              // Običan <a>, ne Link: odgovor je fajl za preuzimanje, a ne stranica; zato nema ni prefetch-a
              <a href={exportHref} className="text-blue-600 hover:text-blue-800 font-medium">
                Preuzmi CSV (najviše {formatNumber(EXPORT_MAX_ROWS)} redova)
              </a>
            )}
          </span>
        </div>
        {!users && <p className="text-xs text-amber-700 mt-2">Spisak advokata trenutno nije dostupan.</p>}
      </form>

      {!parsed.ok ? (
        <div role="alert" className="bg-white rounded-lg border border-red-200 p-6 text-center text-red-700">
          {parsed.error}
        </div>
      ) : loadFailed ? (
        <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-700">
          Greška pri učitavanju aktivnosti. Pokušajte ponovo.
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#16263D]/10 p-8 text-center text-[#16263D]/60">
          Nema zabeleženih aktivnosti za izabrane filtere.
        </div>
      ) : (
        <ul className="bg-white rounded-lg border border-[#16263D]/10 overflow-hidden shadow-sm divide-y divide-[#16263D]/10">
          {rows.map((row) => {
            const { label, details } = describeActivity(row, NO_TITLES);
            return (
              <li key={row.id} className="p-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${ATTENTION_ACTIONS.has(row.action) ? 'text-amber-700' : 'text-[#16263D]'}`}>{label}</p>
                  {details.map((line) => (
                    <p key={line} className="text-xs text-[#16263D]/60 break-words">
                      {line}
                    </p>
                  ))}
                  <p className="text-xs text-[#16263D]/50 mt-0.5">Korisnik: {row.actor_email ?? 'obrisan nalog'}</p>
                </div>
                <div className="text-xs text-[#16263D]/50 sm:text-right whitespace-nowrap">
                  <p>{formatBelgrade(row.created_at)}</p>
                  {row.ip && <p>IP {row.ip}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {parsed.ok && !loadFailed && (filter.cursor || nextHref) && (
        <div className="flex items-center justify-between text-xs">
          {filter.cursor ? (
            <Link href={pageHref(filter)} className="text-blue-600 hover:text-blue-800 font-medium">
              ← Na početak
            </Link>
          ) : (
            <span />
          )}
          {nextHref ? (
            // prefetch={false}: sledeća strana zavisi od kursora, a ne treba je čitati unapred
            <Link href={nextHref} prefetch={false} className="text-blue-600 hover:text-blue-800 font-medium">
              Starije →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
