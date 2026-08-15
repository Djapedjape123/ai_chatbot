'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
    const supabase = createClient();

    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);

        if (!email.trim()) {
            setError('Unesite email.');
            return;
        }
        ///app\auth\callback

        setLoading(true);
        // ZAMENI OVO:
        // redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`

        // SA OVIM:
        await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${window.location.origin}/reset-password`,
        });

        setLoading(false);
        // Uvek prikazujemo istu poruku, bez obzira da li email postoji — bezbednosni razlog
        setSubmitted(true);
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F7F3EC] px-4">
            <div className="w-full max-w-sm">
                <h1 className="text-2xl font-semibold text-[#16263D] text-center mb-8">
                    Zaboravljena lozinka
                </h1>

                {submitted ? (
                    <div className="text-sm text-[#16263D] bg-white border border-[#16263D]/10 rounded-md px-4 py-3 text-center">
                        Ako nalog sa ovim emailom postoji, poslali smo link za resetovanje lozinke. Proverite inbox (i spam folder).
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
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
                            {loading ? 'Slanje…' : 'Pošalji link za reset'}
                        </button>
                    </form>
                )}

                <p className="text-sm text-[#16263D]/60 text-center mt-6">
                    <Link href="/login" className="text-[#16263D] underline">
                        Nazad na prijavu
                    </Link>
                </p>
            </div>
        </div>
    );
}