import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-page';
import { effectiveLimits, parseOfficeSettings } from '@/lib/limits';
import { displayName, formatNumber, parseAdminUsers, userStatus, userUsage } from '@/lib/admin-overview';
import { roleLabel } from '@/lib/admin-users';
import { formatBelgrade } from '@/lib/activity';
import InviteForm from './InviteForm';
import StatusBadge from './StatusBadge';

// Bez `export const metadata` (kao ni ostale stranice panela): naslov taba bi otkrio da panel postoji.

function UsageBar({ percent, reason }: { percent: number; reason: string }) {
  const color = percent >= 100 ? 'bg-red-600' : percent >= 80 ? 'bg-amber-500' : 'bg-[#16263D]/60';
  return (
    <div className="min-w-[8rem]">
      <div
        role="progressbar"
        aria-label="Iskorišćenost najopterećenijeg limita"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        className="h-1.5 w-full rounded bg-[#16263D]/10"
      >
        <div className={`h-1.5 rounded ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <p className="text-xs text-[#16263D]/60 mt-1">
        {percent}% · {reason}
      </p>
    </div>
  );
}

export default async function AdminUsersPage() {
  const { supabase } = await requireAdminPage('/admin/users');

  // Čitanja idu preko korisničkog klijenta (JWT + RLS); admin_list_users() sama proverava admina + aal2
  const [users, settings] = await Promise.all([
    supabase.rpc('admin_list_users'),
    supabase
      .from('office_settings')
      .select('daily_message_limit, daily_document_limit, daily_token_budget, monthly_token_budget')
      .maybeSingle(),
  ]);

  if (users.error) console.error('Admin Users Error:', users.error);
  if (settings.error) console.error('Admin Users Settings Error:', settings.error);

  const list = users.error ? null : parseAdminUsers(users.data);
  const limits = effectiveLimits(parseOfficeSettings(settings.data));
  const now = new Date();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#16263D]">Advokati</h1>
        <p className="text-sm text-[#16263D]/60 mt-1">Nalozi kancelarije, pozivi i potrošnja.</p>
      </div>

      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Pozovi advokata
        </h2>
        <InviteForm />
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Nalozi
        </h2>
        {!list ? (
          <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-700">
            Greška pri učitavanju naloga. Pokušajte ponovo.
          </div>
        ) : list.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#16263D]/10 p-6 text-center text-sm text-[#16263D]/60">Nema naloga.</div>
        ) : (
          <div className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-xs text-[#16263D]/60 border-b border-[#16263D]/10">
                  <th className="p-3 font-medium">Advokat</th>
                  <th className="p-3 font-medium">Uloga</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Dvostepena prijava</th>
                  <th className="p-3 font-medium">Poslednja prijava</th>
                  <th className="p-3 font-medium text-right">Dokumenti</th>
                  <th className="p-3 font-medium text-right">Razgovori</th>
                  <th className="p-3 font-medium">Potrošnja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#16263D]/10">
                {list.map((u) => {
                  const usage = userUsage(u, limits);
                  return (
                    <tr key={u.id} className="align-top">
                      <td className="p-3">
                        {/* prefetch={false}: otvaranje stranice jednog advokata upisuje zapis u dnevnik aktivnosti */}
                        <Link href={`/admin/users/${u.id}`} prefetch={false} className="font-medium text-[#16263D] hover:underline break-words">
                          {displayName(u)}
                        </Link>
                        {u.fullName?.trim() && <p className="text-xs text-[#16263D]/60 break-all">{u.email}</p>}
                      </td>
                      <td className="p-3 text-[#16263D]">{roleLabel(u.role)}</td>
                      <td className="p-3">
                        <StatusBadge status={userStatus(u, now)} />
                      </td>
                      <td className="p-3 text-[#16263D]">{u.hasMfa ? 'Uključena' : 'Nije uključena'}</td>
                      <td className="p-3 text-[#16263D]">{u.lastSignInAt ? formatBelgrade(u.lastSignInAt) : 'Nikad'}</td>
                      <td className="p-3 text-right text-[#16263D]">{formatNumber(u.documentsCount)}</td>
                      <td className="p-3 text-right text-[#16263D]">{formatNumber(u.chatsCount)}</td>
                      <td className="p-3">
                        <UsageBar percent={usage.percent} reason={usage.reason} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-[#16263D]/50 mt-3">
          Potrošnja je procenat najopterećenijeg limita (poruke i dokumenti danas, obrada danas i ovog meseca). Dan i mesec se računaju po
          beogradskom vremenu.
        </p>
      </section>
    </div>
  );
}
