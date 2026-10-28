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
};

export function usageStatus(summary: UsageSummary, limits: Limits): UsageStatus {
  const ratios = [
    summary.daily_messages / limits.dailyMessages,
    summary.daily_documents / limits.dailyDocuments,
    summary.daily_tokens / limits.dailyTokens,
    summary.monthly_tokens / limits.monthlyTokens,
  ];
  const max = Math.max(...ratios);
  return { summary, limits, maxPercent: Math.round(max * 100), warning: max >= WARNING_RATIO };
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
