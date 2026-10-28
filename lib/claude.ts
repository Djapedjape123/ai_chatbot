// Pomoćne funkcije za pozive Claude i Voyage API-ja iz /api/chat: izbor modela, procena tokena za
// rezervaciju i čitanje odgovora (tekst + STVARNA potrošnja). Bez server-only importa, da bi se
// moglo testirati (npm test).
import { estimateTokens } from './limits.ts';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
export const CHAT_MAX_OUTPUT_TOKENS = 4096;
// System prompt + do 8 izvoda po ~1000 znakova (chunkSize iz /api/ingest) + oznake: oko 3.600 tokena
export const CHAT_CONTEXT_ALLOWANCE_TOKENS = 4000;

type Env = Record<string, string | undefined>;

// Model se bira iz CLAUDE_MODEL (jedna kancelarija = jedan deploy). Vrednost ide u telo zahteva,
// pa prihvatamo samo oblik ID-a modela; sve ostalo tiho pada na podrazumevani model.
export function getClaudeModel(env: Env = process.env): string {
  const value = env.CLAUDE_MODEL?.trim();
  return value && /^claude-[a-z0-9-]+$/.test(value) ? value : DEFAULT_CLAUDE_MODEL;
}

// Procena za rezervaciju PRE poziva: pitanje ide i na Voyage i na Claude, istorija se šalje ponovo
// svaki put (glavni trošak), a izlaz može da dostigne max_tokens. Posle poziva se upisuje stvarna potrošnja.
export function estimateChatTokens(query: string, history: string[]): number {
  const q = estimateTokens(query);
  const h = history.reduce((sum, text) => sum + estimateTokens(text), 0);
  return q + q + h + CHAT_CONTEXT_ALLOWANCE_TOKENS + CHAT_MAX_OUTPUT_TOKENS;
}

export type ClaudeResult = {
  answer: string;
  // null = API nije vratio ispravan broj; ruta tada računa procenu, a ne nulu (nula bi izbegla budžet)
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
};

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function parseClaudeResponse(data: unknown): ClaudeResult | null {
  if (!isRecord(data) || !Array.isArray(data.content)) return null;

  const answer = data.content
    .filter((b): b is { type: 'text'; text: string } => isRecord(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');

  const usage = isRecord(data.usage) ? data.usage : {};
  return {
    answer,
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    stopReason: typeof data.stop_reason === 'string' ? data.stop_reason : null,
  };
}

export type VoyageResult = { embedding: number[]; tokens: number | null };

export function parseVoyageResponse(data: unknown): VoyageResult | null {
  if (!isRecord(data) || !Array.isArray(data.data)) return null;
  const first = data.data[0];
  if (!isRecord(first) || !Array.isArray(first.embedding) || first.embedding.length === 0) return null;
  if (!first.embedding.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;

  const usage = isRecord(data.usage) ? data.usage : {};
  return { embedding: first.embedding as number[], tokens: tokenCount(usage.total_tokens) };
}
