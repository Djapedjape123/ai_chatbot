import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/require-user';
import { mfaNextPath } from '@/lib/mfa-gate';
import MfaChallengeForm from './MfaChallengeForm';

export const metadata: Metadata = { title: 'Dvostepena prijava | Pravni Asistent' };

export default async function MfaLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = mfaNextPath((await searchParams).next);

  // allowMfaPending: ovo je jedina stranica na kojoj nalog bez unetog koda sme da bude
  const { user, assurance } = await requireUser({ allowMfaPending: true });
  if (!user) redirect('/login');
  // Nema šta da se proveri: nalog nema potvrđen faktor, ili je kod već unet
  if (!assurance.pending) redirect(next);

  const factor = (user.factors ?? []).find((f) => f.status === 'verified' && f.factor_type === 'totp');
  return <MfaChallengeForm factorId={factor?.id ?? null} next={next} />;
}
