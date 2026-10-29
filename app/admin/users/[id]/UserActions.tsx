'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { disableLawyer, enableLawyer, resendInvite, setRole } from '@/app/admin/actions';
import type { UserStatus } from '@/lib/admin-overview';
import type { ActionResult } from '@/lib/admin-users';

type Props = { userId: string; name: string; status: UserStatus; role: string | null; isSelf: boolean };

const NEUTRAL = 'border-[#16263D]/20 bg-white text-[#16263D] hover:bg-[#16263D]/5';
const DANGER = 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-800';

// Svaka radnja traži potvrdu (kao brisanje dokumenta). Odluku o pravu na radnju donosi server (app/admin/actions.ts),
// a dugmad koja bi bila odbijena (sopstveni nalog) ovde se samo ne prikazuju.
export default function UserActions({ userId, name, status, role, isSelf }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // leave: posle promene stanja nazad na spisak (stranica jednog advokata bi ponovo upisala zapis o pregledu)
  function run(confirmText: string, call: () => Promise<ActionResult>, leave: boolean) {
    if (!window.confirm(confirmText)) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await call();
      if ('error' in result) {
        setError(result.error);
        return;
      }
      if (leave) router.push('/admin/users');
      else setMessage(result.message);
    });
  }

  const button = (label: string, tone: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`text-sm font-medium rounded border px-3 py-1.5 transition disabled:opacity-50 ${tone}`}
    >
      {label}
    </button>
  );

  return (
    <section aria-labelledby="actions-heading">
      <h2 id="actions-heading" className="text-sm font-semibold text-[#16263D] mb-3">
        Radnje
      </h2>
      <div className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {status === 'blocked' &&
            button('Odblokiraj nalog', NEUTRAL, () =>
              run(`Odblokirati nalog „${name}"? Advokat će ponovo moći da se prijavi.`, () => enableLawyer(userId), true),
            )}
          {status !== 'blocked' &&
            !isSelf &&
            button('Blokiraj nalog', DANGER, () =>
              run(
                `Blokirati nalog „${name}"? Advokat više neće moći da se prijavi ni da koristi aplikaciju. Njegovi dokumenti i razgovori ostaju sačuvani, a blokadu možete ukloniti u svakom trenutku.`,
                () => disableLawyer(userId),
                true,
              ),
            )}
          {status === 'invited' &&
            button('Pošalji poziv ponovo', NEUTRAL, () =>
              run(`Ponovo poslati poziv nalogu „${name}"?`, () => resendInvite(userId), false),
            )}
          {role === 'lawyer' &&
            !isSelf &&
            button('Postavi za admina', NEUTRAL, () =>
              run(
                `Postaviti „${name}" za admina? Admin vidi naloge, potrošnju i dnevnik aktivnosti cele kancelarije, može da poziva i blokira naloge. Sadržaj dokumenata i razgovora ne vidi.`,
                () => setRole(userId, 'admin'),
                true,
              ),
            )}
          {role === 'admin' &&
            !isSelf &&
            button('Vrati na advokata', NEUTRAL, () =>
              run(`Vratiti „${name}" na ulogu advokata? Gubi pristup admin panelu.`, () => setRole(userId, 'lawyer'), true),
            )}
        </div>

        {isSelf && <p className="text-xs text-[#16263D]/60">Ovo je vaš nalog: ne možete ga blokirati niti menjati sopstvenu ulogu.</p>}
        {role === null && <p className="text-xs text-[#16263D]/60">Nalog nema profil, pa mu se uloga ne može menjati.</p>}

        <div aria-live="polite">
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {message && <p className="text-sm text-green-700">{message}</p>}
        </div>
      </div>
    </section>
  );
}
