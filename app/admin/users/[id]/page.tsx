import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin-page';
import { uuidSchema } from '@/lib/validation';
import { effectiveLimits, parseOfficeSettings } from '@/lib/limits';
import { displayName, formatNumber, userStatus } from '@/lib/admin-overview';
import { parseAdminUserDetail, roleLabel } from '@/lib/admin-users';
import { formatBelgrade } from '@/lib/activity';
import StatusBadge from '../StatusBadge';
import UserActions from './UserActions';

// Bez `export const metadata` (kao ni ostale stranice panela): naslov taba bi otkrio da panel postoji.

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm p-4">
      <p className="text-xs text-[#16263D]/60">{label}</p>
      <p className="text-xl font-semibold text-[#16263D] mt-1">{value}</p>
      {hint && <p className="text-xs text-[#16263D]/50 mt-1">{hint}</p>}
    </div>
  );
}

const dateTime = (iso: string | null) => (iso ? formatBelgrade(iso) : '—');

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const validId = uuidSchema.safeParse(id).success;

  // Provera pristupa PRE svega ostalog: ko nije admin dobija 404 bez obzira na ID. Neispravan ID ne ide ni u `next`.
  const admin = await requireAdminPage(validId ? `/admin/users/${id}` : '/admin/users');
  if (!validId) notFound();

  // admin_get_user() proverava admina + aal2 i SAMA upisuje zapis o pregledu (jedan zapis po otvaranju stranice)
  const [detailRes, settings] = await Promise.all([
    admin.supabase.rpc('admin_get_user', { p_user_id: id }),
    admin.supabase
      .from('office_settings')
      .select('daily_message_limit, daily_document_limit, daily_token_budget, monthly_token_budget')
      .maybeSingle(),
  ]);

  if (detailRes.error) console.error('Admin User Error:', detailRes.error);
  if (settings.error) console.error('Admin User Settings Error:', settings.error);

  const result = detailRes.error ? ({ kind: 'invalid' } as const) : parseAdminUserDetail(detailRes.data);
  if (result.kind === 'not_found') notFound();
  if (result.kind === 'invalid') {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-700">
        Greška pri učitavanju naloga. Pokušajte ponovo.
      </div>
    );
  }

  const { user, documents, chats } = result.detail;
  const limits = effectiveLimits(parseOfficeSettings(settings.data));
  const status = userStatus(user, new Date());
  const name = displayName(user);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/users" className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          ← Svi advokati
        </Link>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-[#16263D] break-words">{name}</h1>
          <StatusBadge status={status} />
        </div>
        {user.fullName?.trim() && <p className="text-sm text-[#16263D]/60 mt-1 break-all">{user.email}</p>}
        <p className="text-xs text-[#16263D]/50 mt-3">
          Ovaj pregled je zabeležen u dnevniku aktivnosti. Prikazuju se samo nazivi i datumi, ne i sadržaj dokumenata i poruka. Naslov
          razgovora je početak prvog pitanja i može sadržati ime klijenta.
        </p>
      </div>

      <section aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Nalog
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Uloga" value={roleLabel(user.role)} />
          <Stat label="Dvostepena prijava" value={user.hasMfa ? 'Uključena' : 'Nije uključena'} />
          <Stat label="Poslednja prijava" value={user.lastSignInAt ? formatBelgrade(user.lastSignInAt) : 'Nikad'} />
          <Stat label="Nalog otvoren" value={dateTime(user.createdAt)} hint={user.invitedAt ? `Pozvan: ${dateTime(user.invitedAt)}` : undefined} />
        </div>
        {user.disabledAt && (
          <p className="text-xs text-red-700 mt-3">Nalog je blokiran {formatBelgrade(user.disabledAt)}.</p>
        )}
      </section>

      <section aria-labelledby="usage-heading">
        <h2 id="usage-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Potrošnja
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Poruke danas" value={`${formatNumber(user.dailyMessages)} / ${formatNumber(limits.dailyMessages)}`} />
          <Stat label="Dokumenti danas" value={`${formatNumber(user.dailyDocuments)} / ${formatNumber(limits.dailyDocuments)}`} />
          <Stat label="Obrada danas (tokeni)" value={`${formatNumber(user.dailyTokens)} / ${formatNumber(limits.dailyTokens)}`} />
          <Stat label="Obrada ovog meseca (tokeni)" value={`${formatNumber(user.monthlyTokens)} / ${formatNumber(limits.monthlyTokens)}`} />
        </div>
      </section>

      <section aria-labelledby="docs-heading">
        <h2 id="docs-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Dokumenti ({formatNumber(documents.length)})
        </h2>
        {documents.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#16263D]/10 p-6 text-center text-sm text-[#16263D]/60">Nema dokumenata.</div>
        ) : (
          <ul className="bg-white rounded-lg border border-[#16263D]/10 overflow-hidden shadow-sm divide-y divide-[#16263D]/10">
            {documents.map((d) => (
              <li key={d.id} className="p-4 flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-[#16263D] break-words min-w-0">{d.title?.trim() || '(bez naziva)'}</p>
                <p className="shrink-0 text-xs text-[#16263D]/60 text-right">
                  {formatBelgrade(d.createdAt)}
                  <br />
                  pasusa: {formatNumber(d.chunkCount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="chats-heading">
        <h2 id="chats-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Razgovori ({formatNumber(chats.length)})
        </h2>
        {chats.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#16263D]/10 p-6 text-center text-sm text-[#16263D]/60">Nema razgovora.</div>
        ) : (
          <ul className="bg-white rounded-lg border border-[#16263D]/10 overflow-hidden shadow-sm divide-y divide-[#16263D]/10">
            {chats.map((c) => (
              <li key={c.id} className="p-4 flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-[#16263D] break-words min-w-0">{c.title?.trim() || '(bez naslova)'}</p>
                <p className="shrink-0 text-xs text-[#16263D]/60 text-right">
                  {formatBelgrade(c.createdAt)}
                  <br />
                  poruka: {formatNumber(c.messageCount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <UserActions userId={user.id} name={name} status={status} role={user.role} isSelf={user.id === admin.user.id} />
    </div>
  );
}
