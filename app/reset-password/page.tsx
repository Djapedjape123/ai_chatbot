'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!password || !confirmPassword) {
      setError('Popunite oba polja.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Lozinke se ne poklapaju.');
      return;
    }
    if (password.length < 6) {
      setError('Lozinka mora imati bar 6 karaktera.');
      return;
    }

    setLoading(true);

    const { error: updateError } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (updateError) {
      setError('Greška pri promeni lozinke. Link je možda istekao — zatražite novi.');
      return;
    }

    router.refresh();
    router.push('/');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F3EC] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#16263D] text-center mb-8">
          Nova lozinka
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#16263D] mb-1">Nova lozinka</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-[#16263D]/20 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#16263D]/30"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm text-[#16263D] mb-1">Potvrdite lozinku</label>
            <input
              type="password"
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
            {loading ? 'Čuvanje…' : 'Sačuvaj novu lozinku'}
          </button>
        </form>
      </div>
    </div>
  );
}