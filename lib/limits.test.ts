import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLimits, DEFAULT_LIMITS, usageStatus, estimateTokens, limitMessage } from './limits.ts';

test('getLimits: bez env-a važe podrazumevani limiti (100 poruka, 20 dokumenata)', () => {
  assert.deepEqual(getLimits({}), DEFAULT_LIMITS);
  assert.equal(DEFAULT_LIMITS.dailyMessages, 100);
  assert.equal(DEFAULT_LIMITS.dailyDocuments, 20);
});

test('getLimits: ispravne env vrednosti se koriste', () => {
  const l = getLimits({ DAILY_MESSAGE_LIMIT: '50', DAILY_DOCUMENT_LIMIT: ' 5 ', DAILY_TOKEN_BUDGET: '1000', MONTHLY_TOKEN_BUDGET: '9000' });
  assert.deepEqual(l, { dailyMessages: 50, dailyDocuments: 5, dailyTokens: 1000, monthlyTokens: 9000 });
});

test('getLimits: neispravna vrednost ne isključuje limit, već pada na podrazumevanu', () => {
  for (const bad of ['', '0', '-5', '1.5', 'abc', '1e9', '99999999999999999999']) {
    assert.equal(getLimits({ DAILY_MESSAGE_LIMIT: bad }).dailyMessages, 100, `DAILY_MESSAGE_LIMIT=${bad}`);
  }
});

test('usageStatus: upozorenje od 80% bilo kog limita', () => {
  const limits = getLimits({});
  const base = { daily_messages: 0, daily_documents: 0, daily_tokens: 0, monthly_tokens: 0 };
  assert.equal(usageStatus(base, limits).warning, false);
  assert.equal(usageStatus({ ...base, daily_messages: 79 }, limits).warning, false);
  assert.equal(usageStatus({ ...base, daily_messages: 80 }, limits).warning, true);
  assert.equal(usageStatus({ ...base, daily_documents: 16 }, limits).maxPercent, 80);
  assert.equal(usageStatus({ ...base, monthly_tokens: 20_000_000 }, limits).maxPercent, 100);
});

test('estimateTokens: oko 3 znaka po tokenu, zaokruženo naviše', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 2);
});

test('limitMessage: poruka zavisi od vrste i razloga', () => {
  const limits = getLimits({});
  assert.match(limitMessage('chat', 'daily_count', limits), /100 poruka/);
  assert.match(limitMessage('ingest', 'daily_count', limits), /20 dokumenata/);
  assert.match(limitMessage('chat', 'monthly_tokens', limits), /administratoru/);
});
