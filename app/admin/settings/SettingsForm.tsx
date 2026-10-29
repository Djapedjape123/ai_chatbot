'use client';

import { useActionState } from 'react';
import { updateSettings } from '@/app/admin/actions';
import { formatNumber } from '@/lib/admin-overview';
import type { SettingRow, SettingsState } from '@/lib/office-settings';

const INITIAL: SettingsState = { status: 'idle' };
const INPUT = 'w-full rounded border border-[#16263D]/20 bg-white px-3 py-2 text-sm text-[#16263D] focus:outline-none focus:ring-2 focus:ring-[#16263D]/30';

export default function SettingsForm({ rows }: { rows: SettingRow[] }) {
  const [state, formAction, pending] = useActionState(updateSettings, INITIAL);

  return (
    <form action={formAction} className="bg-white rounded-lg border border-[#16263D]/10 shadow-sm p-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((row) => {
          // Posle akcije React prazni polja; pri grešci se vraćaju uneta, a posle uspeha važi vrednost iz baze.
          // key remontira polje kad se prikazana vrednost promeni.
          const shown = state.status === 'error' ? state.values[row.key] : String(row.value);
          return (
            <div key={row.key}>
              <label className="block text-sm text-[#16263D]">
                {row.label}
                <input
                  key={`${row.key}-${shown}`}
                  name={row.key}
                  defaultValue={shown}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  autoComplete="off"
                  className={`mt-1 ${INPUT}`}
                />
              </label>
              <p className="text-xs text-[#16263D]/50 mt-1">
                {row.hint}
                {row.cap !== null && ` · Gornja granica ugovora: ${formatNumber(row.cap)}`}
              </p>
              {row.note && <p className="text-xs text-amber-700 mt-0.5">{row.note}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[#16263D] px-4 py-2 text-sm font-medium text-[#F7F3EC] hover:bg-[#16263D]/90 transition disabled:opacity-50"
        >
          {pending ? 'Čuvanje…' : 'Sačuvaj podešavanja'}
        </button>
        <div aria-live="polite">
          {state.status === 'error' && (
            <p role="alert" className="text-sm text-red-700">
              {state.error}
            </p>
          )}
          {state.status === 'success' && <p className="text-sm text-green-700">{state.message}</p>}
        </div>
      </div>
    </form>
  );
}
