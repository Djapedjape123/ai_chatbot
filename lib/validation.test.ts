import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatRequestSchema, uuidSchema, MAX_QUERY_LENGTH, ingestFormSchema, ingestFormInput, MAX_FILE_SIZE } from './validation.ts';

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

test('ingestForm: fajl je obavezan, ne prazan, najviše 4MB i PDF', () => {
  const msg = (input: unknown) => ingestFormSchema.safeParse(input).error?.issues[0].message;
  assert.equal(msg({}), 'Niste poslali PDF fajl.');
  assert.equal(msg({ file: 'tekst' }), 'Niste poslali PDF fajl.');
  assert.equal(msg({ file: pdf('') }), 'Fajl je prazan (0 bajtova).');
  assert.match(msg({ file: pdf(new Uint8Array(MAX_FILE_SIZE + 1)) })!, /4MB/);
  assert.equal(msg({ file: pdf('x', 'skripta.exe', 'application/octet-stream') }), 'Dozvoljen je isključivo PDF format fajla.');
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
