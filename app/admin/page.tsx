import { requireAdminPage } from '@/lib/admin-page';
import { effectiveLimits, parseOfficeSettings } from '@/lib/limits';
import { formatNumber, nearLimit, parseAdminUsers, summarizeOffice } from '@/lib/admin-overview';

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm p-4">
      <p className="text-xs text-[#16263D]/60">{label}</p>
      <p className="text-2xl font-semibold text-[#16263D] mt-1">{value}</p>
      {hint && <p className="text-xs text-[#16263D]/50 mt-1 break-words">{hint}</p>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const { supabase } = await requireAdminPage('/admin');

  // Čitanja idu preko korisničkog klijenta (JWT + RLS). admin_list_users() je security definer i sama proverava
  // da je pozivalac admin sa aal2, pa isti poziv direktno preko REST API-ja bez toga dobija 42501.
  const [users, settings] = await Promise.all([
    supabase.rpc('admin_list_users'),
    supabase
      .from('office_settings')
      .select('daily_message_limit, daily_document_limit, daily_token_budget, monthly_token_budget')
      .maybeSingle(),
  ]);

  if (users.error) console.error('Admin Overview Error:', users.error);
  if (settings.error) console.error('Admin Overview Settings Error:', settings.error);

  const list = users.error ? null : parseAdminUsers(users.data);
  if (!list) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-700">
        Greška pri učitavanju pregleda. Pokušajte ponovo.
      </div>
    );
  }

  // Važeći limiti: podešavanje kancelarije, ograničeno env varijablama (isto što koristi chat)
  const limits = effectiveLimits(parseOfficeSettings(settings.data));
  const now = new Date();
  const summary = summarizeOffice(list, limits, now);
  const near = nearLimit(list, limits, now);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#16263D]">Pregled</h1>
        <p className="text-sm text-[#16263D]/60 mt-1">Stanje kancelarije: nalozi i potrošnja.</p>
        <p className="text-xs text-[#16263D]/50 mt-1">
          Prikazuju se samo brojke i nazivi. Sadržaj dokumenata i poruka administrator ne vidi. Dan i mesec se računaju po beogradskom vremenu.
        </p>
      </div>

      <section aria-labelledby="accounts-heading">
        <h2 id="accounts-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Nalozi
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="Ukupno" value={formatNumber(summary.total)} />
          <Card label="Aktivni" value={formatNumber(summary.active)} />
          <Card label="Pozvani" value={formatNumber(summary.invited)} hint="Nisu potvrdili poziv." />
          <Card label="Blokirani" value={formatNumber(summary.blocked)} />
        </div>
      </section>

      <section aria-labelledby="usage-heading">
        <h2 id="usage-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Potrošnja
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="Poruke danas" value={formatNumber(summary.messagesToday)} />
          <Card label="Dokumenti danas" value={formatNumber(summary.documentsToday)} />
          <Card label="Obrada ovog meseca (tokeni)" value={formatNumber(summary.tokensMonth)} hint="Ukupno za kancelariju." />
          <Card
            label="Najveća mesečna potrošnja"
            value={summary.topMonthly ? `${summary.topMonthly.percent}%` : '0%'}
            hint={
              summary.topMonthly
                ? `${summary.topMonthly.name}: ${formatNumber(summary.topMonthly.tokens)} od ${formatNumber(limits.monthlyTokens)}`
                : 'Još nema potrošnje.'
            }
          />
        </div>
        <p className="text-xs text-[#16263D]/50 mt-3">
          Limiti važe po advokatu: {formatNumber(limits.dailyMessages)} poruka i {formatNumber(limits.dailyDocuments)} dokumenata dnevno;
          budžet obrade {formatNumber(limits.dailyTokens)} dnevno i {formatNumber(limits.monthlyTokens)} mesečno.
        </p>
      </section>

      <section aria-labelledby="near-heading">
        <h2 id="near-heading" className="text-sm font-semibold text-[#16263D] mb-3">
          Blizu limita (80% ili više)
        </h2>
        {near.length === 0 ? (
          <div className="bg-white rounded-lg border border-[#16263D]/10 p-6 text-center text-sm text-[#16263D]/60">
            Nijedan advokat nije blizu limita.
          </div>
        ) : (
          <ul className="bg-white rounded-lg border border-[#16263D]/10 overflow-hidden shadow-sm divide-y divide-[#16263D]/10">
            {near.map((hit) => (
              <li key={hit.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#16263D] break-words">{hit.name}</p>
                  <p className="text-xs text-[#16263D]/60">{hit.reason}</p>
                </div>
                <span className={`shrink-0 text-sm font-semibold ${hit.percent >= 100 ? 'text-red-700' : 'text-amber-700'}`}>
                  {hit.percent}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
