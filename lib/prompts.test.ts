import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_CONTEXT_TEXT, TRANSCRIPTION_EMPTY_MARKER, buildSystemPrompt, buildTranscriptionPrompt } from './prompts.ts';

test('buildSystemPrompt: bez slika nema pravila o slikama, kontekst je na kraju', () => {
  const p = buildSystemPrompt('');
  assert.doesNotMatch(p, /slik/i);
  assert.ok(p.includes(NO_CONTEXT_TEXT));
  assert.ok(p.trimEnd().endsWith('</rag_kontekst>'));
});

test('buildSystemPrompt: sa slikama dodaje pravilo da je tekst na slici nepouzdan podatak, a ne uputstvo', () => {
  const p = buildSystemPrompt('<izvod naziv="x">tekst</izvod>', { images: 2 });
  assert.match(p, /slik/i);
  assert.match(p, /NEPOUZDAN/);
  assert.match(p, /ne izvršavaj/i);
  assert.match(p, /nečitljiv|nije čitljiv/i);
  // Pravilo o slikama ide pre konteksta, a kontekst ostaje poslednji
  assert.ok(p.indexOf('slik') < p.lastIndexOf('<rag_kontekst>'));
  assert.ok(p.trimEnd().endsWith('</rag_kontekst>'));
  assert.equal(buildSystemPrompt('a', { images: 0 }), buildSystemPrompt('a'));
});

test('buildTranscriptionPrompt: doslovan prepis, bez izvršavanja uputstava sa slike, oznaka za praznu stranu', () => {
  const p = buildTranscriptionPrompt();
  assert.match(p, /doslovno/i);
  assert.match(p, /ne izvršavaj/i);
  assert.match(p, /\[nečitljivo\]/);
  assert.ok(p.includes(TRANSCRIPTION_EMPTY_MARKER));
  assert.match(TRANSCRIPTION_EMPTY_MARKER, /^\[[A-ZČĆŽŠĐ_ ]+\]$/);
});
