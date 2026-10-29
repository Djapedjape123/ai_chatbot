import { requireAdminPage } from '@/lib/admin-page';
import { parseOfficeSettings } from '@/lib/limits';
import { OFFICE_SETTINGS_COLUMNS, describeSettings } from '@/lib/office-settings';
import SettingsForm from './SettingsForm';

// Bez `export const metadata` (kao ni ostale stranice panela): naslov taba bi otkrio da panel postoji.

export default async function AdminSettingsPage() {
  const { supabase } = await requireAdminPage('/admin/settings');

  // Čitanje preko korisničkog klijenta (RLS: svaki prijavljeni korisnik sme da čita office_settings)
  const { data, error } = await supabase.from('office_settings').select(OFFICE_SETTINGS_COLUMNS).maybeSingle();
  if (error) console.error('Admin Settings Error:', error);
  const settings = error ? null : parseOfficeSettings(data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#16263D]">Podešavanja</h1>
        <p className="text-sm text-[#16263D]/60 mt-1">Ograničenja potrošnje koja važe za svakog advokata ponaosob.</p>
        <p className="text-xs text-[#16263D]/50 mt-1">
          Promena važi odmah, od sledećeg zahteva. Granica ugovora (postavlja se na serveru) ne može da se pređe: ako je vrednost iznad nje, važi
          granica. Svaka promena se beleži u dnevnik aktivnosti (staro i novo).
        </p>
      </div>

      {settings ? (
        <SettingsForm rows={describeSettings(settings)} />
      ) : (
        <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-700">
          Greška pri učitavanju podešavanja. Pokušajte ponovo.
        </div>
      )}
    </div>
  );
}
