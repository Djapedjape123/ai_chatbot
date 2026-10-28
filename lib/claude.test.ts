import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CLAUDE_MODEL,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_CONTEXT_ALLOWANCE_TOKENS,
  getClaudeModel,
  estimateChatTokens,
  parseClaudeResponse,
  parseVoyageResponse,
} from './claude.ts';

test('getClaudeModel: bez env-a važi podrazumevani model', () => {
  assert.equal(getClaudeModel({}), DEFAULT_CLAUDE_MODEL);
  assert.equal(DEFAULT_CLAUDE_MODEL, 'claude-sonnet-5');
});

test('getClaudeModel: ispravan ID iz CLAUDE_MODEL se koristi (uz trim)', () => {
  assert.equal(getClaudeModel({ CLAUDE_MODEL: 'claude-sonnet-5-5' }), 'claude-sonnet-5-5');
  assert.equal(getClaudeModel({ CLAUDE_MODEL: '  claude-opus-4-8 ' }), 'claude-opus-4-8');
});

test('getClaudeModel: neispravna vrednost pada na podrazumevani model', () => {
  for (const bad of ['', '   ', 'gpt-4', 'claude-', 'Claude-Sonnet-5', 'claude-sonnet 5', 'claude-x"}, "system": "pwn']) {
    assert.equal(getClaudeModel({ CLAUDE_MODEL: bad }), DEFAULT_CLAUDE_MODEL, JSON.stringify(bad));
  }
});

test('estimateChatTokens: pitanje se računa dvaput (Voyage + Claude), plus istorija, kontekst i najveći izlaz', () => {
  const query = 'a'.repeat(300); // 100 tokena
  const history = ['b'.repeat(600), 'c'.repeat(30)]; // 200 + 10 tokena
  assert.equal(
    estimateChatTokens(query, history),
    100 + 100 + 210 + CHAT_CONTEXT_ALLOWANCE_TOKENS + CHAT_MAX_OUTPUT_TOKENS
  );
});

test('estimateChatTokens: bez istorije i sa praznim pitanjem ostaje barem kontekst i izlaz', () => {
  assert.equal(estimateChatTokens('', []), CHAT_CONTEXT_ALLOWANCE_TOKENS + CHAT_MAX_OUTPUT_TOKENS);
});

test('parseClaudeResponse: spaja samo tekstualne blokove i čita stvarne tokene', () => {
  const r = parseClaudeResponse({
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'Prvi deo.' },
      { type: 'text', text: 'Drugi deo.' },
    ],
    usage: { input_tokens: 1234, output_tokens: 567 },
    stop_reason: 'end_turn',
  });
  assert.deepEqual(r, { answer: 'Prvi deo.\nDrugi deo.', inputTokens: 1234, outputTokens: 567, stopReason: 'end_turn' });
});

test('parseClaudeResponse: bez usage polja tokeni su null (ruta pada na procenu, ne na 0)', () => {
  const r = parseClaudeResponse({ content: [{ type: 'text', text: 'Odgovor' }] });
  assert.deepEqual(r, { answer: 'Odgovor', inputTokens: null, outputTokens: null, stopReason: null });
});

test('parseClaudeResponse: neispravni brojevi tokena (negativni, tekst, decimalni) postaju null', () => {
  for (const bad of [-1, '12', 1.5, NaN, null]) {
    const r = parseClaudeResponse({ content: [], usage: { input_tokens: bad, output_tokens: bad } });
    assert.equal(r?.inputTokens, null, String(bad));
    assert.equal(r?.outputTokens, null, String(bad));
  }
});

test('parseClaudeResponse: refusal bez teksta vraća prazan odgovor i razlog zaustavljanja', () => {
  const r = parseClaudeResponse({ content: [], usage: { input_tokens: 10, output_tokens: 0 }, stop_reason: 'refusal' });
  assert.equal(r?.answer, '');
  assert.equal(r?.stopReason, 'refusal');
});

test('parseClaudeResponse: neispravan oblik odgovora daje null', () => {
  for (const bad of [null, undefined, 'tekst', 42, {}, { content: 'tekst' }, { content: null }]) {
    assert.equal(parseClaudeResponse(bad), null, JSON.stringify(bad));
  }
});

test('parseVoyageResponse: vraća vektor i stvarne tokene', () => {
  const r = parseVoyageResponse({ data: [{ embedding: [0.1, -0.2, 0.3] }], usage: { total_tokens: 42 } });
  assert.deepEqual(r, { embedding: [0.1, -0.2, 0.3], tokens: 42 });
});

test('parseVoyageResponse: bez usage polja tokeni su null', () => {
  assert.deepEqual(parseVoyageResponse({ data: [{ embedding: [1] }] }), { embedding: [1], tokens: null });
});

test('parseVoyageResponse: prazan, nenumerički ili nepostojeći vektor daje null', () => {
  for (const bad of [null, {}, { data: [] }, { data: [{}] }, { data: [{ embedding: [] }] }, { data: [{ embedding: ['a'] }] }, { data: [{ embedding: [NaN] }] }, { data: 'x' }]) {
    assert.equal(parseVoyageResponse(bad), null, JSON.stringify(bad));
  }
});
