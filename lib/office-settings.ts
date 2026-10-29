import { formatNumber } from './admin-overview.ts';
import { positiveInt, type Limits } from './limits.ts';

// Podešavanja kancelarije u admin panelu (2.5.8): četiri limita po advokatu. Čist kod bez server-only importa (npm test).
// Pravila (opseg, mesečni >= dnevni) su u settingsSchema (lib/validation.ts), a ovde je prikaz i priprema poziva.

export type SettingKey = keyof Limits;

// Kolone reda office_settings koje čitaju stranica i akcija (parseOfficeSettings ih sve traži)
export const OFFICE_SETTINGS_COLUMNS = 'daily_message_limit, daily_document_limit, daily_token_budget, monthly_token_budget';

// Redosled je redosled prikaza. envName je promenljiva koja postavlja gornju granicu (lib/limits.ts).
export const SETTINGS_FIELDS: { key: SettingKey; label: string; envName: string; hint: string }[] = [
  { key: 'dailyMessages', label: 'Dnevni limit poruka', envName: 'DAILY_MESSAGE_LIMIT', hint: 'poruka po advokatu dnevno' },
  { key: 'dailyDocuments', label: 'Dnevni limit dokumenata', envName: 'DAILY_DOCUMENT_LIMIT', hint: 'dokumenata po advokatu dnevno' },
  { key: 'dailyTokens', label: 'Dnevni budžet obrade', envName: 'DAILY_TOKEN_BUDGET', hint: 'tokena po advokatu dnevno' },
  { key: 'monthlyTokens', label: 'Mesečni budžet obrade', envName: 'MONTHLY_TOKEN_BUDGET', hint: 'tokena po advokatu mesečno' },
];

export type SettingRow = {
  key: SettingKey;
  label: string;
  hint: string;
  // Vrednost koju je postavio admin (ono što je upisano u bazi)
  value: number;
  // Gornja granica iz env-a (ugovor), null ako nije postavljena ili nije ispravna
  cap: number | null;
  // Šta zaista važi: manje od to dvoje (isto računa effectiveLimits u lib/limits.ts)
  effective: number;
  // Napomena samo kad granica skraćuje vrednost admina
  note: string | null;
};

type Env = Record<string, string | undefined>;

export function describeSettings(settings: Limits, env: Env = process.env): SettingRow[] {
  return SETTINGS_FIELDS.map(({ key, label, envName, hint }) => {
    const value = settings[key];
    const parsed = positiveInt(env[envName], Infinity);
    const cap = Number.isFinite(parsed) ? parsed : null;
    const effective = cap === null ? value : Math.min(value, cap);
    const note = cap !== null && cap < value ? `Važi gornja granica ugovora: ${formatNumber(cap)}` : null;
    return { key, label, hint, value, cap, effective, note };
  });
}

// Nazivi parametara su nazivi iz funkcije public.admin_update_settings (migracija 20261028150000)
export function settingsRpcArgs(limits: Limits) {
  return {
    p_daily_message_limit: limits.dailyMessages,
    p_daily_document_limit: limits.dailyDocuments,
    p_daily_token_budget: limits.dailyTokens,
    p_monthly_token_budget: limits.monthlyTokens,
  };
}

// Snimanje istih vrednosti ne bi promenilo ništa, a pravilo bi lažan zapis "Promenjena podešavanja" u dnevniku
export function settingsUnchanged(current: Limits, next: Limits): boolean {
  return SETTINGS_FIELDS.every(({ key }) => current[key] === next[key]);
}

const GENERIC_ERROR = 'Snimanje podešavanja nije uspelo. Pokušajte ponovo.';

// Kodovi koje baca admin_update_settings: 42501 (nije admin ili nema aal2), 22023 (prazna vrednost) i 23514
// (CHECK ograničenje tabele: vrednost van opsega). 23514 ovde NIJE "poslednji admin" kao kod promene uloge.
export function describeSettingsRpcError(error: { code?: unknown; message?: unknown } | null | undefined): string {
  switch (error?.code) {
    case '42501':
      return 'Nemate dozvolu za ovu radnju.';
    case '22023':
      return 'Neispravan zahtev.';
    case '23514':
      return 'Vrednost je van dozvoljenog opsega.';
    default:
      return GENERIC_ERROR;
  }
}

// Vrednosti polja kako ih je admin ukucao (tekst), da se vrate u formu posle greške
export type SettingsValues = Record<SettingKey, string>;

// Stanje forme za podešavanja (useActionState). Ovde, a ne u 'use server' fajlu, da ga koriste i klijentske komponente.
export type SettingsState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; error: string; values: SettingsValues };
