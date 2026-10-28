'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { MIN_PASSWORD_LENGTH, describePasswordUpdateError, validateNewPassword } from '@/lib/password-policy';

// Zajednička forma za /set-password (pozvani advokat) i /reset-password (zaboravljena lozinka).
// Sesiju je već uspostavio /auth/confirm; ovde se samo menja lozinka direktno kod Supabase Auth-a.
export default function NewPasswordForm({
  title,
  intro,
  submitLabel,
}: {
  title: string;
  intro?: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const problem = validateNewPassword(password, confirmPassword);
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(describePasswordUpdateError(updateError));
      return;
    }

    router.refresh();
    router.push('/chat');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F3EC] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#16263D] text-center mb-3">{title}</h1>
        {intro && <p className="text-sm text-[#16263D]/70 text-center mb-8">{intro}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-password" className="block text-sm text-[#16263D] mb-1">
              Nova lozinka
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-[#16263D]/20 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#16263D]/30"
              disabled={loading}
            />
            <p className="text-xs text-[#16263D]/60 mt-1">Najmanje {MIN_PASSWORD_LENGTH} znakova.</p>
          </div>

          <div>
            <label htmlFor="confirm-password" className="block text-sm text-[#16263D] mb-1">
              Potvrdite lozinku
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-md border border-[#16263D]/20 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#16263D]/30"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-[#16263D] text-[#F7F3EC] py-2 hover:bg-[#16263D]/90 disabled:opacity-50 transition"
          >
            {loading ? 'Čuvanje…' : submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
