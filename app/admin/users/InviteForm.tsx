'use client';

import { useActionState } from 'react';
import { inviteLawyer } from '@/app/admin/actions';
import type { InviteState } from '@/lib/admin-users';

const INITIAL: InviteState = { status: 'idle' };
const INPUT = 'w-full rounded border border-[#16263D]/20 bg-white px-3 py-2 text-sm text-[#16263D] focus:outline-none focus:ring-2 focus:ring-[#16263D]/30';

export default function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteLawyer, INITIAL);
  // Posle akcije React prazni polja; pri grešci se vraćaju uneta, da admin ne kuca ponovo. key remontira polje sa novom vrednošću.
  const values = state.status === 'error' ? state.values : { email: '', fullName: '' };

  return (
    <form action={formAction} className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="block text-sm text-[#16263D]">
          Ime i prezime
          <input
            key={`name-${values.fullName}`}
            name="fullName"
            defaultValue={values.fullName}
            maxLength={100}
            required
            autoComplete="off"
            className={`mt-1 ${INPUT}`}
          />
        </label>
        <label className="block text-sm text-[#16263D]">
          Email
          <input
            key={`email-${values.email}`}
            type="email"
            name="email"
            defaultValue={values.email}
            maxLength={254}
            required
            autoComplete="off"
            className={`mt-1 ${INPUT}`}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[#16263D] px-4 py-2 text-sm font-medium text-[#F7F3EC] hover:bg-[#16263D]/90 transition disabled:opacity-50"
        >
          {pending ? 'Slanje…' : 'Pošalji poziv'}
        </button>
      </div>

      <p className="text-xs text-[#16263D]/50 mt-3">
        Advokat dobija mejl sa linkom i sam postavlja lozinku. Najviše 20 poziva u 24 sata.
      </p>
      <div aria-live="polite">
        {state.status === 'error' && (
          <p role="alert" className="text-sm text-red-700 mt-2">
            {state.error}
          </p>
        )}
        {state.status === 'success' && <p className="text-sm text-green-700 mt-2">{state.message}</p>}
      </div>
    </form>
  );
}
