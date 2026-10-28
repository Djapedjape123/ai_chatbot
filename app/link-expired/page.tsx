import Link from 'next/link';

// Odredište /auth/confirm kad link ne važi (istekao, već iskorišćen ili neispravan). Javna stranica, bez prijave.
export default function LinkExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F3EC] px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-[#16263D] text-center mb-6">Link nije važeći</h1>

        <div className="text-sm text-[#16263D] bg-white border border-[#16263D]/10 rounded-md px-4 py-3 space-y-2">
          <p>Link iz emaila je istekao, već je iskorišćen ili nije ispravan. Takvi linkovi važe kratko i mogu se upotrebiti samo jednom.</p>
          <p>Ako ste pozvani u kancelariju, zatražite novi poziv od administratora.</p>
          <p>Ako ste zaboravili lozinku, zatražite novi link.</p>
        </div>

        <p className="text-sm text-center mt-6 space-x-4">
          <Link href="/forgot-password" className="text-[#16263D] underline">
            Zaboravljena lozinka
          </Link>
          <Link href="/login" className="text-[#16263D] underline">
            Nazad na prijavu
          </Link>
        </p>
      </div>
    </div>
  );
}
