import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/require-user';
import { MFA_LOGIN_PATH, mfaNextPath } from '@/lib/mfa-gate';
import { formatBelgrade } from '@/lib/activity';
import SecurityPanel from './SecurityPanel';

export const metadata: Metadata = { title: 'Bezbednost naloga | Pravni Asistent' };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = mfaNextPath((await searchParams).next);

  // allowMfaPending: nalog bez unetog koda ne sme da menja faktore, pa ga šaljemo na unos koda (proxy to radi i pre ove provere)
  const { user, assurance } = await requireUser({ allowMfaPending: true });
  if (!user) redirect('/login');
  if (assurance.pending) redirect(`${MFA_LOGIN_PATH}?next=${encodeURIComponent('/account/security')}`);

  // Faktori stižu uz korisnika iz getUser(), bez dodatnog poziva. Prikazuju se samo potvrđeni.
  const factors = (user.factors ?? [])
    .filter((f) => f.status === 'verified' && f.factor_type === 'totp')
    .map((f) => ({
      id: f.id,
      name: f.friendly_name || 'Aplikacija za autentifikaciju',
      createdLabel: formatBelgrade(f.created_at),
    }));

  return (
    <div className="min-h-screen bg-[#F7F3EC] p-6 md:p-12">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold text-[#16263D]">Bezbednost naloga</h1>
        <p className="text-sm text-[#16263D]/60 mt-1 break-all">{user.email}</p>

        <SecurityPanel factors={factors} next={next} adminRequired={next.startsWith('/admin')} />
      </div>
    </div>
  );
}
