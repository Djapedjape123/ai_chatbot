'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
  const supabase = createClient();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      setError('Popunite sva polja.');
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

    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });

    setLoading(false);

    if (signUpError) {
      if (signUpError.message.includes('already registered') || signUpError.message.includes('already exists')) {
        setError('Nalog sa ovim emailom već postoji. Prijavite se umesto toga.');
      } else if (signUpError.message.includes('Password')) {
        setError('Lozinka mora imati bar 6 karaktera.');
      } else {
        setError('Greška pri registraciji. Pokušajte ponovo.');
      }
      return;
    }

    router.refresh();
    router.push('/chat');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F3EC] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#16263D] text-center mb-8">
          Napravite nalog
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-[#16263D] mb-1">Ime</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[#16263D]/20 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#16263D]/30"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm text-[#16263D] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-[#16263D]/20 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#16263D]/30"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm text-[#16263D] mb-1">Lozinka</label>
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
            {loading ? 'Pravljenje naloga…' : 'Registruj se'}
          </button>
        </form>

        <p className="text-sm text-[#16263D]/60 text-center mt-6">
          Već imate nalog?{' '}
          <Link href="/login" className="text-[#16263D] underline">
            Prijavite se
          </Link>
        </p>
      </div>
    </div>
  );
}