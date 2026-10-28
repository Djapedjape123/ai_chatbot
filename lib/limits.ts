// Limiti potrošnje po advokatu. Jedna kancelarija = jedan deploy, pa se limiti čitaju iz env varijabli.
// Bez server-only importa, da bi se računanje moglo testirati (npm test).

export type Limits = {
  dailyMessages: number;
  dailyDocuments: number;
  dailyTokens: number;
  monthlyTokens: number;
};

export const DEFAULT_LIMITS: Limits = {
  dailyMessages: 100,
  dailyDocuments: 20,
  dailyTokens: 1_000_000,
  monthlyTokens: 20_000_000,
};

// Upozorenje u aplikaciji kreće od 80% bilo kog limita, blokada (429) je na 100%.
export const WARNING_RATIO = 0.8;

type Env = Record<string, string | undefined>;

// Neispravna vrednost (prazno, nula, negativno, decimalno, tekst) tiho pada na podrazumevanu:
// greška u env-u ne sme da isključi limit.
function positiveInt(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value.trim())) return fallback;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function getLimits(env: Env = process.env): Limits {
  return {
    dailyMessages: positiveInt(env.DAILY_MESSAGE_LIMIT, DEFAULT_LIMITS.dailyMessages),
    dailyDocuments: positiveInt(env.DAILY_DOCUMENT_LIMIT, DEFAULT_LIMITS.dailyDocuments),
    dailyTokens: positiveInt(env.DAILY_TOKEN_BUDGET, DEFAULT_LIMITS.dailyTokens),
    monthlyTokens: positiveInt(env.MONTHLY_TOKEN_BUDGET, DEFAULT_LIMITS.monthlyTokens),
  };
}

// Gruba procena tokena iz teksta (~3 znaka po tokenu za srpski). Služi samo za rezervaciju;
// posle poziva se upisuje stvarna potrošnja iz odgovora API-ja.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export type UsageSummary = {
  daily_messages: number;
  daily_documents: number;
  daily_tokens: number;
  monthly_tokens: number;
};

export type UsageStatus = {
  summary: UsageSummary;
  limits: Limits;
  // Najveći procenat iskorišćenosti među svim limitima (0-100+), za traku u UI-ju
  maxPercent: number;
  warning: boolean;
  // Tekst upozorenja za limit koji je najbliži prekoračenju (null dok je ispod 80%)
  warningMessage: string | null;
};

type LimitKey = keyof UsageSummary;

function warningText(key: LimitKey, summary: UsageSummary, limits: Limits, ratio: number): string {
  const percent = Math.round(ratio * 100);
  switch (key) {
    case 'daily_messages':
      return `Iskoristili ste ${summary.daily_messages} od ${limits.dailyMessages} dnevnih poruka.`;
    case 'daily_documents':
      return `Iskoristili ste ${summary.daily_documents} od ${limits.dailyDocuments} dnevnih dokumenata.`;
    case 'daily_tokens':
      return `Iskoristili ste ${percent}% dnevnog budžeta obrade.`;
    case 'monthly_tokens':
      return `Iskoristili ste ${percent}% mesečnog budžeta obrade.`;
  }
}

export function usageStatus(summary: UsageSummary, limits: Limits): UsageStatus {
  const ratios: [LimitKey, number][] = [
    ['daily_messages', summary.daily_messages / limits.dailyMessages],
    ['daily_documents', summary.daily_documents / limits.dailyDocuments],
    ['daily_tokens', summary.daily_tokens / limits.dailyTokens],
    ['monthly_tokens', summary.monthly_tokens / limits.monthlyTokens],
  ];
  // Pri izjednačenju važi prvi po redu (strogo veći menja izbor)
  const [topKey, max] = ratios.reduce((top, cur) => (cur[1] > top[1] ? cur : top));
  const warning = max >= WARNING_RATIO;
  return {
    summary,
    limits,
    maxPercent: Math.round(max * 100),
    warning,
    warningMessage: warning ? warningText(topKey, summary, limits, max) : null,
  };
}

// Red iz get_usage_summary(). PostgREST vraća niz sa jednim redom, a bigint kolone mogu stići kao tekst.
// Neispravan oblik daje null: upozorenje se tada izostavlja, a odgovor korisniku ne pada.
export function parseUsageSummary(data: unknown): UsageSummary | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;

  const count = (v: unknown): number | null => {
    const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
    return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const daily_messages = count(r.daily_messages);
  const daily_documents = count(r.daily_documents);
  const daily_tokens = count(r.daily_tokens);
  const monthly_tokens = count(r.monthly_tokens);
  if (daily_messages === null || daily_documents === null || daily_tokens === null || monthly_tokens === null) return null;
  return { daily_messages, daily_documents, daily_tokens, monthly_tokens };
}

// Šta ide klijentu: samo procenat, zastavica i tekst. Sirovi brojači i limiti ostaju na serveru.
export type ClientUsage = { percent: number; warning: boolean; message: string | null };

export function clientUsage(status: UsageStatus): ClientUsage {
  return { percent: status.maxPercent, warning: status.warning, message: status.warningMessage };
}

export type LimitReason = 'daily_count' | 'daily_tokens' | 'monthly_tokens';

export function limitMessage(kind: 'chat' | 'ingest', reason: LimitReason, limits: Limits): string {
  if (reason === 'daily_count') {
    return kind === 'chat'
      ? `Dostigli ste dnevni limit od ${limits.dailyMessages} poruka. Pokušajte ponovo sutra.`
      : `Dostigli ste dnevni limit od ${limits.dailyDocuments} dokumenata. Pokušajte ponovo sutra.`;
  }
  return reason === 'daily_tokens'
    ? 'Dostigli ste dnevni budžet obrade. Pokušajte ponovo sutra.'
    : 'Dostignut je mesečni budžet obrade. Obratite se administratoru kancelarije.';
}
