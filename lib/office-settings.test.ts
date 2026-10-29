import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFICE_SETTINGS_COLUMNS,
  SETTINGS_FIELDS,
  describeSettings,
  describeSettingsRpcError,
  settingsRpcArgs,
  settingsUnchanged,
} from './office-settings.ts';
import { parseOfficeSettings, type Limits } from './limits.ts';

const CURRENT: Limits = { dailyMessages: 100, dailyDocuments: 20, dailyTokens: 1_000_000, monthlyTokens: 20_000_000 };

test('SETTINGS_FIELDS: četiri limita sa nazivima polja iz forme i oznakama za prikaz', () => {
  assert.deepEqual(
    SETTINGS_FIELDS.map((f) => [f.key, f.label]),
    [
      ['dailyMessages', 'Dnevni limit poruka'],
      ['dailyDocuments', 'Dnevni limit dokumenata'],
      ['dailyTokens', 'Dnevni budžet obrade'],
      ['monthlyTokens', 'Mesečni budžet obrade'],
    ],
  );
});

test('describeSettings: bez env granice važi vrednost admina i nema napomene', () => {
  const rows = describeSettings(CURRENT, {});
  assert.deepEqual(
    rows.map((r) => [r.key, r.value, r.cap, r.effective, r.note]),
    [
      ['dailyMessages', 100, null, 100, null],
      ['dailyDocuments', 20, null, 20, null],
      ['dailyTokens', 1_000_000, null, 1_000_000, null],
      ['monthlyTokens', 20_000_000, null, 20_000_000, null],
    ],
  );
});

test('describeSettings: env granica ispod vrednosti admina važi umesto nje, uz napomenu', () => {
  const rows = describeSettings(CURRENT, { DAILY_MESSAGE_LIMIT: '50', MONTHLY_TOKEN_BUDGET: '5000000' });
  const messages = rows.find((r) => r.key === 'dailyMessages')!;
  assert.equal(messages.value, 100);
  assert.equal(messages.cap, 50);
  assert.equal(messages.effective, 50);
  assert.equal(messages.note, 'Važi gornja granica ugovora: 50');
  const monthly = rows.find((r) => r.key === 'monthlyTokens')!;
  assert.equal(monthly.effective, 5_000_000);
  assert.equal(monthly.note, 'Važi gornja granica ugovora: 5.000.000');
});

test('describeSettings: env granica jednaka ili iznad vrednosti admina se prikazuje, ali ne menja ništa', () => {
  const rows = describeSettings(CURRENT, { DAILY_MESSAGE_LIMIT: '100', DAILY_DOCUMENT_LIMIT: '500' });
  const equal = rows.find((r) => r.key === 'dailyMessages')!;
  assert.deepEqual([equal.cap, equal.effective, equal.note], [100, 100, null]);
  const above = rows.find((r) => r.key === 'dailyDocuments')!;
  assert.deepEqual([above.cap, above.effective, above.note], [500, 20, null]);
});

test('describeSettings: neispravan env se ponaša kao da nije postavljen (isto kao u lib/limits.ts)', () => {
  for (const bad of ['', '0', '-5', 'abc', '1.5']) {
    const row = describeSettings(CURRENT, { DAILY_MESSAGE_LIMIT: bad }).find((r) => r.key === 'dailyMessages')!;
    assert.deepEqual([row.cap, row.effective], [null, 100], JSON.stringify(bad));
  }
  // razmaci oko broja se tolerišu, kao i u getLimits
  const padded = describeSettings(CURRENT, { DAILY_MESSAGE_LIMIT: ' 10 ' }).find((r) => r.key === 'dailyMessages')!;
  assert.deepEqual([padded.cap, padded.effective], [10, 10]);
});

test('describeSettings daje isti efektivni limit kao effectiveLimits (jedna istina)', async () => {
  const { effectiveLimits } = await import('./limits.ts');
  const env = { DAILY_MESSAGE_LIMIT: '50', DAILY_DOCUMENT_LIMIT: '500', DAILY_TOKEN_BUDGET: 'x' };
  const fromView = Object.fromEntries(describeSettings(CURRENT, env).map((r) => [r.key, r.effective]));
  assert.deepEqual(fromView, effectiveLimits(CURRENT, env));
});

test('settingsRpcArgs: nazivi parametara su tačno oni iz funkcije admin_update_settings', () => {
  assert.deepEqual(settingsRpcArgs(CURRENT), {
    p_daily_message_limit: 100,
    p_daily_document_limit: 20,
    p_daily_token_budget: 1_000_000,
    p_monthly_token_budget: 20_000_000,
  });
});

test('settingsUnchanged: prazna promena se ne snima (ne pravi lažan audit zapis)', () => {
  assert.equal(settingsUnchanged(CURRENT, { ...CURRENT }), true);
  for (const key of Object.keys(CURRENT) as (keyof Limits)[]) {
    assert.equal(settingsUnchanged(CURRENT, { ...CURRENT, [key]: CURRENT[key] + 1 }), false, key);
  }
});

test('describeSettingsRpcError: poruke po kodu baze, bez internog teksta', () => {
  assert.match(describeSettingsRpcError({ code: '42501' }), /dozvol/i);
  assert.match(describeSettingsRpcError({ code: '23514' }), /opseg|granic|dozvoljen/i);
  assert.match(describeSettingsRpcError({ code: '22023' }), /neispravan/i);
  const generic = describeSettingsRpcError({ code: 'XX000', message: 'interna greška baze: relation "x"' });
  assert.ok(!generic.includes('relation'));
  assert.match(describeSettingsRpcError(null), /nije uspel/i);
  // 23514 u ovom kontekstu nije "poslednji admin" (to je poruka za promenu uloge)
  assert.ok(!/admin/i.test(describeSettingsRpcError({ code: '23514' })));
});

test('OFFICE_SETTINGS_COLUMNS: tačno one kolone koje parseOfficeSettings traži (stranica i akcija čitaju isti red)', () => {
  const row = Object.fromEntries(OFFICE_SETTINGS_COLUMNS.split(',').map((c, i) => [c.trim(), i + 1]));
  assert.deepEqual(parseOfficeSettings(row), { dailyMessages: 1, dailyDocuments: 2, dailyTokens: 3, monthlyTokens: 4 });
});
