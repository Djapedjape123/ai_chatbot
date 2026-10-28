'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { normalizeMfaCode } from '@/lib/mfa-code';

export default function MfaChallengeForm({ factorId, next }: { factorId: string | null; next: string }) {
  const router = useRouter();
  const supabase = createClient();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalized = normalizeMfaCode(code);
    if (!factorId || !normalized) {
      setError('Unesite 6 cifara koje prikazuje aplikacija.');
      return;
    }

    setLoading(true);
    // Kod ide direktno Supabase Auth-u (challenge + verify), a uspeh podiže sesiju na aal2
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized });
    setLoading(false);

    if (verifyError) {
      setCode('');
      setError('Pogrešan ili istekao kod. Pokušajte ponovo sa novim kodom iz aplikacije.');
      return;
    }

    router.refresh();
    router.replace(next);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.refresh();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F3EC] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#16263D] text-center mb-2">Dvostepena prijava</h1>
        <p className="text-sm text-[#16263D]/70 text-center mb-8">
          Unesite 6-cifreni kod iz aplikacije za autentifikaciju na vašem telefonu.
        </p>

        {!factorId ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
            Za ovaj nalog nije podešena aplikacija za autentifikaciju. Odjavite se i obratite se administratoru kancelarije.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="mfa-code" className="block text-sm text-[#16263D] mb-1">
                Kod
              </label>
              <input
                id="mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={10}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123 456"
                className="w-full rounded-md border border-[#16263D]/20 px-3 py-2 bg-white text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#16263D]/30"
                disabled={loading}
              />
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-[#16263D] text-[#F7F3EC] py-2 hover:bg-[#16263D]/90 disabled:opacity-50 transition"
            >
              {loading ? 'Provera…' : 'Potvrdi'}
            </button>
          </form>
        )}

        <p className="mt-5 text-sm text-center">
          <button type="button" onClick={handleSignOut} className="text-[#16263D] hover:underline">
            Odjavi se
          </button>
        </p>
      </div>
    </div>
  );
}
