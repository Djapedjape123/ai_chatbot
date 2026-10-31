import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatRequestSchema,
  uuidSchema,
  MAX_QUERY_LENGTH,
  ingestFormSchema,
  ingestFormInput,
  attachmentFormSchema,
  attachmentFormInput,
  MAX_FILE_SIZE,
  inviteSchema,
  inviteFormInput,
  roleSchema,
  settingsSchema,
  settingsFormInput,
  SETTINGS_BOUNDS,
} from './validation.ts';

const UUID = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';

test('chatRequest: ispravan zahtev bez chatId prolazi i trimuje pitanje', () => {
  const r = chatRequestSchema.safeParse({ query: '  Šta je zastarelost?  ' });
  assert.equal(r.success, true);
  assert.equal(r.data?.query, 'Šta je zastarelost?');
  assert.equal(r.data?.chatId, undefined);
});

test('chatRequest: chatId null (novi razgovor, kako ga šalje frontend) prolazi', () => {
  const r = chatRequestSchema.safeParse({ query: 'pitanje', chatId: null });
  assert.equal(r.success, true);
  assert.equal(r.data?.chatId, undefined);
});

test('chatRequest: chatId mora biti UUID', () => {
  assert.equal(chatRequestSchema.safeParse({ query: 'x', chatId: UUID }).success, true);
  for (const bad of ['abc', '1', "' or 1=1 --", 42, {}, [UUID], '']) {
    assert.equal(chatRequestSchema.safeParse({ query: 'x', chatId: bad }).success, false, `chatId=${JSON.stringify(bad)}`);
  }
});

test('chatRequest: pitanje je obavezan string, ne samo razmaci', () => {
  for (const bad of [undefined, null, 42, {}, ['x'], '', '   ', '\n\t']) {
    const r = chatRequestSchema.safeParse({ query: bad });
    assert.equal(r.success, false, `query=${JSON.stringify(bad)}`);
    assert.equal(r.error?.issues[0].message, 'Pitanje nije poslato.');
  }
});

test('chatRequest: dužina se meri posle trim-a', () => {
  assert.equal(chatRequestSchema.safeParse({ query: ' ' + 'a'.repeat(MAX_QUERY_LENGTH) + ' ' }).success, true);
  const r = chatRequestSchema.safeParse({ query: 'a'.repeat(MAX_QUERY_LENGTH + 1) });
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0].message, /predugačko.*4000/);
});

test('chatRequest: nepoznata polja se odbacuju (nema mass assignment-a)', () => {
  const r = chatRequestSchema.safeParse({ query: 'x', user_id: UUID, role: 'assistant' });
  assert.equal(r.success, true);
  assert.equal('user_id' in r.data!, false);
  assert.equal('role' in r.data!, false);
});

test('chatRequest: telo koje nije objekat se odbija', () => {
  for (const bad of [null, undefined, 'tekst', 5, []]) {
    assert.equal(chatRequestSchema.safeParse(bad).success, false, `body=${JSON.stringify(bad)}`);
  }
});

test('uuidSchema: samo ispravan UUID', () => {
  assert.equal(uuidSchema.safeParse(UUID).success, true);
  for (const bad of ['', 'abc', '../etc/passwd', UUID + 'x', undefined, 7]) {
    assert.equal(uuidSchema.safeParse(bad).success, false, `uuid=${JSON.stringify(bad)}`);
  }
});

const pdf = (body: string | Uint8Array<ArrayBuffer>, name = 'zakon.pdf', type = 'application/pdf') => new File([body], name, { type });

test('ingestForm: ispravan PDF prolazi, acknowledge je podrazumevano false', () => {
  const r = ingestFormSchema.safeParse({ file: pdf('%PDF-1.7') });
  assert.equal(r.success, true);
  assert.equal(r.data?.acknowledge, false);
  assert.equal(ingestFormSchema.safeParse({ file: pdf('%PDF-1.7'), acknowledge: 'true' }).data?.acknowledge, true);
});

test('ingestForm: fajl je obavezan, ne prazan i najviše 4MB; tip se ne proverava po imenu ni MIME-u (to radi ruta po sadržaju)', () => {
  const msg = (input: unknown) => ingestFormSchema.safeParse(input).error?.issues[0].message;
  assert.equal(msg({}), 'Niste poslali fajl.');
  assert.equal(msg({ file: 'tekst' }), 'Niste poslali fajl.');
  assert.equal(msg({ file: pdf('') }), 'Fajl je prazan (0 bajtova).');
  assert.match(msg({ file: pdf(new Uint8Array(MAX_FILE_SIZE + 1)) })!, /4MB/);
  assert.equal(ingestFormSchema.safeParse({ file: pdf('x', 'skripta.exe', 'application/octet-stream') }).success, true);
  assert.equal(ingestFormSchema.safeParse({ file: pdf('x', 'ugovor.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') }).success, true);
  assert.equal(ingestFormSchema.safeParse({ file: pdf('x'), acknowledge: 'da' }).success, false);
});

test('ingestFormInput: čita polja iz FormData', () => {
  const fd = new FormData();
  fd.set('file', pdf('%PDF'));
  fd.set('acknowledge', 'true');
  const r = ingestFormSchema.safeParse(ingestFormInput(fd));
  assert.equal(r.success, true);
  assert.equal(r.data?.acknowledge, true);
});

// --- Admin panel (2.5): poziv advokata, uloga, podešavanja ---

const firstMessage = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

test('invite: ispravan poziv prolazi, email se svodi na mala slova, ime se trimuje', () => {
  const r = inviteSchema.safeParse({ email: '  Ana.Petrovic@Kancelarija.RS ', fullName: '  Ana Petrović  ' });
  assert.equal(r.success, true);
  assert.deepEqual(r.data, { email: 'ana.petrovic@kancelarija.rs', fullName: 'Ana Petrović' });
});

test('invite: neispravan email se odbija porukom na srpskom', () => {
  for (const bad of [undefined, null, 5, '', '   ', 'abc', 'a@b', 'a b@c.rs', '@c.rs', 'a@@c.rs', `${'a'.repeat(250)}@c.rs`]) {
    const r = inviteSchema.safeParse({ email: bad, fullName: 'Ana' });
    assert.equal(r.success, false, `email=${JSON.stringify(bad)}`);
    assert.equal(firstMessage(r), 'Unesite ispravnu email adresu.', `email=${JSON.stringify(bad)}`);
  }
});

test('invite: ime je obavezno, najviše 100 znakova i bez oznaka ni kontrolnih znakova', () => {
  const msg = (fullName: unknown) => firstMessage(inviteSchema.safeParse({ email: 'a@c.rs', fullName }));
  for (const bad of [undefined, null, '', '   ']) assert.equal(msg(bad), 'Unesite ime i prezime.', JSON.stringify(bad));
  assert.equal(inviteSchema.safeParse({ email: 'a@c.rs', fullName: 'a'.repeat(100) }).success, true);
  assert.match(msg('a'.repeat(101))!, /predugačko.*100/);
  for (const bad of ['<script>alert(1)</script>', 'Ana <b>', 'Ana\u0000', 'Ana\nPetrović', 'Ana‮Petrović']) {
    assert.equal(msg(bad), 'Ime sadrži nedozvoljene znakove.', JSON.stringify(bad));
  }
  assert.equal(inviteSchema.safeParse({ email: 'a@c.rs', fullName: "Ana-Marija Đorđević-O'Brien" }).success, true);
});

test('role: samo admin ili lawyer', () => {
  assert.equal(roleSchema.safeParse('admin').success, true);
  assert.equal(roleSchema.safeParse('lawyer').success, true);
  for (const bad of ['superadmin', 'ADMIN', '', ' admin', undefined, null, 1, {}]) {
    const r = roleSchema.safeParse(bad);
    assert.equal(r.success, false, JSON.stringify(bad));
    assert.equal(firstMessage(r), 'Nepoznata uloga.');
  }
});

const GOOD_SETTINGS = { dailyMessages: '50', dailyDocuments: '10', dailyTokens: '500000', monthlyTokens: '5000000' };

test('settings: ispravne vrednosti iz forme postaju brojevi', () => {
  const r = settingsSchema.safeParse(GOOD_SETTINGS);
  assert.equal(r.success, true);
  assert.deepEqual(r.data, { dailyMessages: 50, dailyDocuments: 10, dailyTokens: 500_000, monthlyTokens: 5_000_000 });
  assert.equal(settingsSchema.safeParse({ ...GOOD_SETTINGS, dailyMessages: ' 7 ' }).data?.dailyMessages, 7);
});

test('settings: granice su iste kao CHECK u bazi (poruke 1-10000, dokumenta 1-1000, tokeni veći od 0)', () => {
  assert.equal(SETTINGS_BOUNDS.dailyMessages.min, 1);
  assert.equal(SETTINGS_BOUNDS.dailyMessages.max, 10000);
  assert.equal(SETTINGS_BOUNDS.dailyDocuments.max, 1000);
  const ok = (over: Record<string, string>) => settingsSchema.safeParse({ ...GOOD_SETTINGS, ...over }).success;
  assert.equal(ok({ dailyMessages: '1' }), true);
  assert.equal(ok({ dailyMessages: '10000' }), true);
  assert.equal(ok({ dailyMessages: '0' }), false);
  assert.equal(ok({ dailyMessages: '10001' }), false);
  assert.equal(ok({ dailyDocuments: '0' }), false);
  assert.equal(ok({ dailyDocuments: '1001' }), false);
  assert.equal(ok({ dailyTokens: '0' }), false);
  assert.equal(ok({ dailyTokens: String(SETTINGS_BOUNDS.dailyTokens.max + 1) }), false);
  assert.equal(ok({ monthlyTokens: '0' }), false);
});

test('settings: samo cele nenegativne cifre, bez decimala, eksponenta, znaka i praznog polja', () => {
  for (const bad of ['', '  ', 'abc', '1.5', '1,5', '1e3', '-1', '+1', '0x10', '１２', '99999999999999999999', null, undefined, 5]) {
    const r = settingsSchema.safeParse({ ...GOOD_SETTINGS, dailyMessages: bad });
    assert.equal(r.success, false, JSON.stringify(bad));
    assert.match(firstMessage(r)!, /Dnevni limit poruka/, JSON.stringify(bad));
  }
});

test('settings: mesečni budžet ne sme biti manji od dnevnog', () => {
  const r = settingsSchema.safeParse({ ...GOOD_SETTINGS, dailyTokens: '600000', monthlyTokens: '500000' });
  assert.equal(r.success, false);
  assert.equal(firstMessage(r), 'Mesečni budžet ne može biti manji od dnevnog.');
  assert.equal(settingsSchema.safeParse({ ...GOOD_SETTINGS, dailyTokens: '500000', monthlyTokens: '500000' }).success, true);
});

test('settingsFormInput: čita polja iz FormData', () => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(GOOD_SETTINGS)) fd.set(k, v);
  fd.set('nepoznato', 'x');
  const r = settingsSchema.safeParse(settingsFormInput(fd));
  assert.equal(r.success, true);
  assert.equal(r.data?.dailyDocuments, 10);
  assert.equal(settingsSchema.safeParse(settingsFormInput(new FormData())).success, false);
});

test('inviteFormInput: čita email i ime iz FormData, a nedostajuće polje daje poruku o tom polju (ne opštu grešku)', () => {
  const fd = new FormData();
  fd.set('email', '  Ana@Kancelarija.RS ');
  fd.set('fullName', ' Ana Anić ');
  fd.set('nepoznato', 'x');
  const ok = inviteSchema.safeParse(inviteFormInput(fd));
  assert.equal(ok.success, true);
  assert.equal(ok.data?.email, 'ana@kancelarija.rs');
  assert.equal(ok.data?.fullName, 'Ana Anić');

  const noName = new FormData();
  noName.set('email', 'ana@kancelarija.rs');
  const bad = inviteSchema.safeParse(inviteFormInput(noName));
  assert.equal(bad.success, false);
  assert.equal(bad.error?.issues[0].message, 'Unesite ime i prezime.');
});

// --- Prilog uz pitanje (Faza 3): samo fajl, bez acknowledge ---

test('attachmentForm: ispravan fajl prolazi, nepoznata polja se odbacuju', () => {
  const r = attachmentFormSchema.safeParse({ file: pdf('x', 'ugovor.docx'), acknowledge: 'true' });
  assert.equal(r.success, true);
  assert.deepEqual(Object.keys(r.data ?? {}), ['file']);
});

test('attachmentForm: fajl je obavezan, ne prazan i najviše 4MB (iste poruke kao za dokument)', () => {
  const msg = (input: unknown) => attachmentFormSchema.safeParse(input).error?.issues[0].message;
  assert.equal(msg({}), 'Niste poslali fajl.');
  assert.equal(msg({ file: 'tekst' }), 'Niste poslali fajl.');
  assert.equal(msg({ file: pdf('') }), 'Fajl je prazan (0 bajtova).');
  assert.match(msg({ file: pdf(new Uint8Array(MAX_FILE_SIZE + 1)) })!, /4MB/);
});

test('attachmentFormInput: čita fajl iz FormData', () => {
  const fd = new FormData();
  fd.set('file', pdf('x', 'prilog.docx'));
  assert.equal(attachmentFormSchema.safeParse(attachmentFormInput(fd)).success, true);
  assert.equal(attachmentFormSchema.safeParse(attachmentFormInput(new FormData())).success, false);
});
