import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/require-user';
import {
  ACTION_LABELS,
  ACTIVITY_ACTIONS,
  PAGE_SIZE,
  describeActivity,
  formatBelgrade,
  parseActivityQuery,
  type ActivityRow,
} from '@/lib/activity';
import type { AuditAction } from '@/lib/audit';

export const metadata: Metadata = { title: 'Aktivnost | Pravni Asistent' };

const COLUMNS = 'id, user_id, actor_email, action, resource_type, resource_id, metadata, ip, created_at';

// Zapisi koji traže pažnju admina (limit, blokiran ili sumnjiv fajl)
const ATTENTION = new Set<string>(['limit_reached', 'document_upload_blocked', 'suspicious_content_flagged']);

function activityHref(page: number, action: AuditAction | null) {
  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/activity?${qs}` : '/activity';
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page, action } = parseActivityQuery(await searchParams);

  const { user, supabase } = await requireUser();
  if (!user) redirect('/login');

  // Čitanja idu preko korisničkog klijenta: RLS daje korisniku svoje zapise, a adminu sve zapise kancelarije.
  // Uloga ovde služi samo za prikaz (kolona "korisnik"), a zaštitu daje baza.
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const isAdmin = profile?.role === 'admin';

  // Jedan red više od strane govori da postoji sledeća strana, bez posebnog brojanja
  const from = (page - 1) * PAGE_SIZE;
  let query = supabase
    .from('audit_log')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + PAGE_SIZE);
  if (!isAdmin) query = query.eq('user_id', user.id); // drugi pojas uz RLS
  if (action) query = query.eq('action', action);

  const [{ data, error }, documents] = await Promise.all([
    query,
    // Naslovi samo za dokumente koji još postoje (RLS: samo korisnikovi). Audit ne čuva nazive fajlova.
    supabase.from('documents').select('id, title').limit(2000),
  ]);

  if (error) console.error('Activity Load Error:', error);

  const all = (data ?? []) as ActivityRow[];
  const rows = all.slice(0, PAGE_SIZE);
  const hasNext = all.length > PAGE_SIZE;
  const titles = new Map<string, string>((documents.data ?? []).map((d) => [d.id as string, d.title as string]));

  return (
    <div className="min-h-screen bg-[#F7F3EC] p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-[#16263D]">Aktivnost</h1>
            <p className="text-sm text-[#16263D]/60 mt-1">
              {isAdmin ? 'Pregled aktivnosti svih korisnika kancelarije.' : 'Pregled vaših aktivnosti.'}
            </p>
            <p className="text-xs text-[#16263D]/50 mt-1">
              Beleže se samo radnje (ko, kada, šta). Tekst pitanja, odgovora i dokumenata se ne čuva. Zapisi se brišu posle 90 dana.
            </p>
          </div>
          <Link
            href="/chat"
            className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded px-3 py-1.5 transition"
          >
            Nazad na Chat
          </Link>
        </div>

        <nav aria-label="Filter po vrsti aktivnosti" className="flex flex-wrap gap-2 mb-4">
          {[null, ...ACTIVITY_ACTIONS].map((a) => (
            <Link
              key={a ?? 'all'}
              href={activityHref(1, a)}
              aria-current={a === action ? 'page' : undefined}
              className={`text-xs rounded-full border px-3 py-1 transition ${
                a === action
                  ? 'bg-[#16263D] text-[#F7F3EC] border-[#16263D]'
                  : 'bg-white text-[#16263D]/70 border-[#16263D]/15 hover:bg-[#16263D]/5'
              }`}
            >
              {a ? ACTION_LABELS[a] : 'Sve'}
            </Link>
          ))}
        </nav>

        {error ? (
          <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-700">
            Greška pri učitavanju aktivnosti. Pokušajte ponovo.
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#16263D]/10 p-8 text-center text-[#16263D]/60">
            Nema zabeleženih aktivnosti{action ? ' ove vrste' : ''}.
          </div>
        ) : (
          <ul className="bg-white rounded-lg border border-[#16263D]/10 overflow-hidden shadow-sm divide-y divide-[#16263D]/10">
            {rows.map((row) => {
              const { label, details } = describeActivity(row, titles);
              return (
                <li key={row.id} className="p-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${ATTENTION.has(row.action) ? 'text-amber-700' : 'text-[#16263D]'}`}>{label}</p>
                    {details.map((line) => (
                      <p key={line} className="text-xs text-[#16263D]/60 break-words">
                        {line}
                      </p>
                    ))}
                    {isAdmin && (
                      <p className="text-xs text-[#16263D]/50 mt-0.5">Korisnik: {row.actor_email ?? 'obrisan nalog'}</p>
                    )}
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

        {(page > 1 || hasNext) && (
          <div className="flex items-center justify-between mt-4 text-xs">
            {page > 1 ? (
              <Link href={activityHref(page - 1, action)} className="text-blue-600 hover:text-blue-800 font-medium">
                ← Novije
              </Link>
            ) : (
              <span />
            )}
            <span className="text-[#16263D]/50">Strana {page}</span>
            {hasNext ? (
              <Link href={activityHref(page + 1, action)} className="text-blue-600 hover:text-blue-800 font-medium">
                Starije →
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
