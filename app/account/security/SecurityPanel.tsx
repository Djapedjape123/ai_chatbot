'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { normalizeMfaCode, qrImageSrc } from '@/lib/mfa-code';
import { recordMfaEnrolled } from './actions';

type Factor = { id: string; name: string; createdLabel: string };
type Enrollment = { factorId: string; qrSrc: string | null; secret: string };

const FACTOR_NAME = 'Aplikacija za autentifikaciju';
const ISSUER = 'Pravni asistent';

export default function SecurityPanel({
  factors,
  next,
  adminRequired,
}: {
  factors: Factor[];
  next: string;
  adminRequired: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function startEnrollment() {
    setError(null);
    setBusy(true);

    // Započet, a nepotvrđen faktor (zatvorena stranica usred uključivanja) ostaje u Supabase-u, pa se prvo uklanja
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const factor of existing?.all ?? []) {
      if (factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: FACTOR_NAME,
      issuer: ISSUER,
    });
    setBusy(false);

    if (enrollError || !data) {
      setError('Uključivanje nije uspelo. Pokušajte ponovo.');
      return;
    }
    setEnrollment({ factorId: data.id, qrSrc: qrImageSrc(data.totp.qr_code), secret: data.totp.secret });
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!enrollment) return;

    const normalized = normalizeMfaCode(code);
    if (!normalized) {
      setError('Unesite 6 cifara koje prikazuje aplikacija.');
      return;
    }

    setBusy(true);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code: normalized,
    });
    if (verifyError) {
      setBusy(false);
      setCode('');
      setError('Pogrešan ili istekao kod. Proverite da li je vreme na telefonu tačno i pokušajte sa novim kodom.');
      return;
    }

    // Zapis u audit log pravi server, posle provere da je faktor stvarno potvrđen. Neuspeh zapisa ne poništava uključivanje.
    await recordMfaEnrolled(enrollment.factorId).catch(() => null);

    setBusy(false);
    setEnrollment(null);
    setCode('');
    router.refresh();
  }

  async function cancelEnrollment() {
    const pending = enrollment;
    setEnrollment(null);
    setCode('');
    setError(null);
    if (pending) await supabase.auth.mfa.unenroll({ factorId: pending.factorId }); // najbolji pokušaj; zaostatak čisti startEnrollment
  }

  async function removeFactor(factorId: string) {
    setError(null);
    setBusy(true);
    // Uklanjanje potvrđenog faktora Supabase dozvoljava samo sesiji koja je prošla proveru koda (aal2)
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);

    if (unenrollError) {
      setError('Isključivanje nije uspelo. Pokušajte ponovo.');
      return;
    }
    setRemovingId(null);
    router.refresh();
  }

  const enabled = factors.length > 0;

  return (
    <div className="mt-6 space-y-4">
      {adminRequired && !enabled && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" role="status">
          Nalog administratora kancelarije mora imati uključenu dvostepenu prijavu. Uključite je da biste nastavili.
        </div>
      )}

      <section className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#16263D]">Dvostepena prijava</h2>
            <p className={`text-sm mt-1 ${enabled ? 'text-green-700' : 'text-[#16263D]/60'}`}>
              {enabled ? 'Uključena' : 'Isključena'}
            </p>
          </div>
        </div>

        {!enabled && !enrollment && (
          <>
            <p className="text-sm text-[#16263D]/70 mt-3">
              Pored lozinke, pri prijavi se traži i 6-cifreni kod iz aplikacije za autentifikaciju na vašem telefonu. Tako ni
              ukradena lozinka nije dovoljna za pristup vašim dokumentima.
            </p>
            <button
              type="button"
              onClick={startEnrollment}
              disabled={busy}
              className="mt-4 rounded-md bg-[#16263D] text-[#F7F3EC] px-4 py-2 text-sm hover:bg-[#16263D]/90 disabled:opacity-50 transition"
            >
              {busy ? 'Priprema…' : 'Uključi dvostepenu prijavu'}
            </button>
          </>
        )}

        {enrollment && (
          <form onSubmit={confirmEnrollment} className="mt-4 space-y-4">
            <ol className="list-decimal pl-5 space-y-3 text-sm text-[#16263D]">
              <li>Instalirajte aplikaciju za autentifikaciju (npr. Google Authenticator, Microsoft Authenticator ili Authy).</li>
              <li>
                Skenirajte QR kod u aplikaciji.
                {enrollment.qrSrc && (
                  <div className="mt-3 flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL (SVG) iz Supabase-a, next/image ne može da ga optimizuje */}
                    <img
                      src={enrollment.qrSrc}
                      alt="QR kod za aplikaciju za autentifikaciju"
                      width={192}
                      height={192}
                      className="rounded border border-[#16263D]/10 bg-white p-2"
                    />
                  </div>
                )}
                <p className="mt-3 text-[#16263D]/70">
                  Ne možete da skenirate? U aplikaciji izaberite ručni unos i upišite ovaj ključ:
                </p>
                <code className="mt-1 block break-all rounded bg-[#F7F3EC] px-2 py-1.5 text-xs select-all">{enrollment.secret}</code>
              </li>
              <li>
                Unesite 6-cifreni kod koji aplikacija prikazuje.
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123 456"
                  aria-label="Kod iz aplikacije"
                  className="mt-2 w-full rounded-md border border-[#16263D]/20 px-3 py-2 bg-white text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#16263D]/30"
                  disabled={busy}
                />
              </li>
            </ol>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-[#16263D] text-[#F7F3EC] px-4 py-2 text-sm hover:bg-[#16263D]/90 disabled:opacity-50 transition"
              >
                {busy ? 'Provera…' : 'Potvrdi kod'}
              </button>
              <button
                type="button"
                onClick={cancelEnrollment}
                disabled={busy}
                className="rounded-md border border-[#16263D]/20 px-4 py-2 text-sm text-[#16263D] hover:bg-[#16263D]/5 disabled:opacity-50 transition"
              >
                Otkaži
              </button>
            </div>
          </form>
        )}

        {enabled && (
          <div className="mt-3">
            <ul className="divide-y divide-[#16263D]/10 text-sm">
              {factors.map((factor) => (
                <li key={factor.id} className="py-2 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[#16263D]">{factor.name}</p>
                    <p className="text-xs text-[#16263D]/50">Dodato {factor.createdLabel}</p>
                  </div>
                  {removingId === null && (
                    <button
                      type="button"
                      onClick={() => setRemovingId(factor.id)}
                      className="shrink-0 text-xs text-red-700 hover:text-red-900 font-medium border border-red-200 bg-red-50 hover:bg-red-100 rounded px-3 py-1.5 transition"
                    >
                      Isključi
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {removingId !== null && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alertdialog" aria-label="Potvrda isključivanja">
                <p>
                  {factors.length > 1
                    ? 'Da li ste sigurni? Ovaj faktor će biti uklonjen, a ostali ostaju uključeni.'
                    : 'Da li ste sigurni? Bez dvostepene prijave nalog je zaštićen samo lozinkom. Ako ste administrator, gubite pristup admin panelu dok je ponovo ne uključite.'}
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => removeFactor(removingId)}
                    disabled={busy}
                    className="rounded-md bg-red-700 text-white px-3 py-1.5 text-xs hover:bg-red-800 disabled:opacity-50 transition"
                  >
                    {busy ? 'Isključivanje…' : 'Da, isključi'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemovingId(null)}
                    disabled={busy}
                    className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-800 hover:bg-red-100 disabled:opacity-50 transition"
                  >
                    Otkaži
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
            {error}
          </div>
        )}
      </section>

      <p className="text-sm">
        <Link href={next} className="text-blue-600 hover:text-blue-800 font-medium">
          {next === '/chat' ? 'Nazad na Chat' : 'Nastavi'}
        </Link>
      </p>
    </div>
  );
}
