import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLimits,
  DEFAULT_LIMITS,
  usageStatus,
  estimateTokens,
  limitMessage,
  parseUsageSummary,
  clientUsage,
  effectiveLimits,
  parseOfficeSettings,
} from './limits.ts';

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

const BASE_SUMMARY = { daily_messages: 0, daily_documents: 0, daily_tokens: 0, monthly_tokens: 0 };

test('usageStatus: bez upozorenja nema ni teksta upozorenja', () => {
  assert.equal(usageStatus(BASE_SUMMARY, getLimits({})).warningMessage, null);
  assert.equal(usageStatus({ ...BASE_SUMMARY, daily_messages: 79 }, getLimits({})).warningMessage, null);
});

test('usageStatus: tekst upozorenja imenuje limit koji je najbliži prekoračenju', () => {
  const limits = getLimits({});
  assert.equal(
    usageStatus({ ...BASE_SUMMARY, daily_messages: 85 }, limits).warningMessage,
    'Iskoristili ste 85 od 100 dnevnih poruka.'
  );
  assert.equal(
    usageStatus({ ...BASE_SUMMARY, daily_documents: 17 }, limits).warningMessage,
    'Iskoristili ste 17 od 20 dnevnih dokumenata.'
  );
  assert.equal(
    usageStatus({ ...BASE_SUMMARY, daily_tokens: 900_000 }, limits).warningMessage,
    'Iskoristili ste 90% dnevnog budžeta obrade.'
  );
  assert.equal(
    usageStatus({ ...BASE_SUMMARY, monthly_tokens: 18_000_000 }, limits).warningMessage,
    'Iskoristili ste 90% mesečnog budžeta obrade.'
  );
});

test('usageStatus: pri izjednačenju važi prvi limit po redu (poruke), a preko 100% poruka ostaje', () => {
  const limits = getLimits({});
  const tie = usageStatus({ ...BASE_SUMMARY, daily_messages: 90, daily_documents: 18 }, limits);
  assert.equal(tie.warningMessage, 'Iskoristili ste 90 od 100 dnevnih poruka.');
  const over = usageStatus({ ...BASE_SUMMARY, daily_messages: 100 }, limits);
  assert.equal(over.warning, true);
  assert.equal(over.maxPercent, 100);
});

test('parseUsageSummary: čita red iz niza (oblik koji vraća PostgREST za funkciju sa tabelom)', () => {
  assert.deepEqual(
    parseUsageSummary([{ daily_messages: 3, daily_documents: 1, daily_tokens: 1470, monthly_tokens: 1470 }]),
    { daily_messages: 3, daily_documents: 1, daily_tokens: 1470, monthly_tokens: 1470 }
  );
});

test('parseUsageSummary: prihvata i objekat i brojeve zapisane kao tekst (bigint)', () => {
  assert.deepEqual(
    parseUsageSummary({ daily_messages: '3', daily_documents: 0, daily_tokens: '1470', monthly_tokens: '9007199254740' }),
    { daily_messages: 3, daily_documents: 0, daily_tokens: 1470, monthly_tokens: 9007199254740 }
  );
});

test('parseUsageSummary: nepotpun ili neispravan red daje null (upozorenje se tada samo izostavlja)', () => {
  const ok = { daily_messages: 1, daily_documents: 1, daily_tokens: 1, monthly_tokens: 1 };
  for (const bad of [null, undefined, [], 'x', 5, {}, { ...ok, daily_tokens: undefined }, { ...ok, daily_messages: -1 }, { ...ok, monthly_tokens: 'abc' }, { ...ok, daily_documents: NaN }, { ...ok, daily_tokens: 1.5 }]) {
    assert.equal(parseUsageSummary(bad), null, JSON.stringify(bad));
  }
});

test('clientUsage: klijent dobija samo procenat, zastavicu i tekst, bez sirovih brojača', () => {
  const status = usageStatus({ ...BASE_SUMMARY, daily_messages: 85 }, getLimits({}));
  assert.deepEqual(clientUsage(status), { percent: 85, warning: true, message: 'Iskoristili ste 85 od 100 dnevnih poruka.' });
  assert.deepEqual(clientUsage(usageStatus(BASE_SUMMARY, getLimits({}))), { percent: 0, warning: false, message: null });
});

// --- Podešavanja kancelarije (2.5): admin podešava, env je gornja granica ---

const SETTINGS = { dailyMessages: 50, dailyDocuments: 10, dailyTokens: 500_000, monthlyTokens: 5_000_000 };

test('effectiveLimits: bez env-a važi podešavanje admina', () => {
  assert.deepEqual(effectiveLimits(SETTINGS, {}), SETTINGS);
});

test('effectiveLimits: env je gornja granica: manji env pobeđuje, veći ne podiže podešavanje', () => {
  const l = effectiveLimits(SETTINGS, { DAILY_MESSAGE_LIMIT: '20', DAILY_DOCUMENT_LIMIT: '500', MONTHLY_TOKEN_BUDGET: '1000' });
  assert.deepEqual(l, { dailyMessages: 20, dailyDocuments: 10, dailyTokens: 500_000, monthlyTokens: 1000 });
});

test('effectiveLimits: neispravan env je bez efekta, a limit se ni tada ne gasi', () => {
  for (const bad of ['', '0', '-5', '1.5', 'abc', '1e9']) {
    assert.equal(effectiveLimits(SETTINGS, { DAILY_MESSAGE_LIMIT: bad }).dailyMessages, 50, `DAILY_MESSAGE_LIMIT=${bad}`);
  }
});

test('effectiveLimits: bez podešavanja (baza ne odgovara) važi stari način: env, odnosno podrazumevane vrednosti', () => {
  assert.deepEqual(effectiveLimits(null, {}), DEFAULT_LIMITS);
  assert.deepEqual(effectiveLimits(null, { DAILY_MESSAGE_LIMIT: '7' }), getLimits({ DAILY_MESSAGE_LIMIT: '7' }));
});

test('parseOfficeSettings: red iz baze, bigint kolone mogu stići kao tekst', () => {
  const row = { daily_message_limit: 50, daily_document_limit: 10, daily_token_budget: '500000', monthly_token_budget: 5_000_000 };
  assert.deepEqual(parseOfficeSettings(row), SETTINGS);
  assert.deepEqual(parseOfficeSettings([row]), SETTINGS);
});

test('parseOfficeSettings: nepotpun ili neispravan red daje null (važe env i podrazumevane vrednosti)', () => {
  const ok = { daily_message_limit: 50, daily_document_limit: 10, daily_token_budget: 500_000, monthly_token_budget: 5_000_000 };
  for (const bad of [null, undefined, [], 'x', 5, {}, { ...ok, daily_message_limit: 0 }, { ...ok, daily_document_limit: -1 }, { ...ok, daily_token_budget: 'abc' }, { ...ok, monthly_token_budget: undefined }, { ...ok, daily_message_limit: 1.5 }]) {
    assert.equal(parseOfficeSettings(bad), null, JSON.stringify(bad));
  }
});
