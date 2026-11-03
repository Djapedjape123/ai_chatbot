import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSCRIBE_MAX_OUTPUT_TOKENS,
  TRANSCRIBE_PROMPT_ALLOWANCE_TOKENS,
  buildImageUserContent,
  estimateImageTokens,
  estimateTranscriptionTokens,
  imageCountLabel,
  imageMessageContent,
  inspectImages,
  parseTranscription,
} from './chat-images.ts';
import { IMAGE_MAX_BYTES, IMAGES_MAX_TOTAL_BYTES, MAX_DOCUMENT_PAGES, MAX_IMAGES_PER_QUESTION, TRANSCRIPT_MAX_LENGTH } from './image-limits.ts';
import { TRANSCRIPTION_EMPTY_MARKER } from './prompts.ts';
import { EXIF_GPS_APP1, buildJpeg, containsText } from './test-support/jpeg-builder.ts';
import { chatImagesFormInput, chatImagesFormSchema, transcribeFormInput, transcribeFormSchema, transcriptIngestSchema } from './validation.ts';

const jpegFile = (bytes: Uint8Array, name = 'slika.jpg') => new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'image/jpeg' });

test('imageCountLabel: srpska množina (1 slika, 2-4 slike, 5 slika)', () => {
  assert.equal(imageCountLabel(1), '📷 1 slika');
  assert.equal(imageCountLabel(2), '📷 2 slike');
  assert.equal(imageCountLabel(4), '📷 4 slike');
  assert.equal(imageCountLabel(5), '📷 5 slika');
});

test('imageMessageContent: u istoriju ide samo oznaka i pitanje, bez sadržaja slike', () => {
  assert.equal(imageMessageContent(2, 'Koji su rokovi?'), '📷 2 slike\n\nKoji su rokovi?');
});

test('estimateImageTokens: širina x visina / 750, zaokruženo naviše', () => {
  assert.equal(estimateImageTokens(1568, 1176), Math.ceil((1568 * 1176) / 750));
  assert.equal(estimateImageTokens(750, 1), 1);
  assert.equal(estimateImageTokens(751, 1), 2);
});

test('inspectImages: sve ispravne slike prolaze, EXIF se uklanja, dimenzije i redosled ostaju', () => {
  const r = inspectImages([buildJpeg({ before: [EXIF_GPS_APP1], width: 1568, height: 1176 }), buildJpeg({ width: 800, height: 1200 })]);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.images.length, 2);
  assert.deepEqual([r.images[0].width, r.images[0].height], [1568, 1176]);
  assert.deepEqual([r.images[1].width, r.images[1].height], [800, 1200]);
  assert.equal(containsText(r.images[0].bytes, 'GPSLatitude'), false);
});

test('inspectImages: prva neispravna slika odbija ceo zahtev i javlja koja je (1-based)', () => {
  const r = inspectImages([buildJpeg(), new TextEncoder().encode('%PDF-1.7'), buildJpeg({ width: 5000, height: 10 })]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.index, 2);
  assert.equal(r.rejection.reason, 'unsupported_type');
});

test('inspectImages: prazan spisak i previše slika se odbijaju', () => {
  const none = inspectImages([]);
  assert.equal(none.ok, false);
  const many = inspectImages(Array.from({ length: MAX_IMAGES_PER_QUESTION + 1 }, () => buildJpeg()));
  assert.equal(many.ok, false);
  const max = inspectImages(Array.from({ length: MAX_IMAGES_PER_QUESTION }, () => buildJpeg()));
  assert.equal(max.ok, true);
});

test('buildImageUserContent: slike idu PRE teksta, kao base64 JPEG bez metapodataka', () => {
  const r = inspectImages([buildJpeg({ before: [EXIF_GPS_APP1] }), buildJpeg({ width: 300, height: 400 })]);
  assert.ok(r.ok);
  if (!r.ok) return;
  const content = buildImageUserContent(r.images, 'Šta piše?');
  assert.equal(content.length, 3);
  assert.deepEqual(content[2], { type: 'text', text: 'Šta piše?' });
  for (let i = 0; i < 2; i++) {
    const block = content[i];
    assert.equal(block.type, 'image');
    if (block.type !== 'image') continue;
    assert.equal(block.source.type, 'base64');
    assert.equal(block.source.media_type, 'image/jpeg');
    assert.deepEqual(new Uint8Array(Buffer.from(block.source.data, 'base64')), r.images[i].bytes);
    assert.doesNotMatch(block.source.data, /\s/);
  }
});

test('chatImagesFormSchema: pitanje, opcioni chatId i 1-5 slika', () => {
  const fd = new FormData();
  fd.append('query', '  Koji su rokovi?  ');
  fd.append('images', jpegFile(buildJpeg()));
  fd.append('images', jpegFile(buildJpeg()));
  const r = chatImagesFormSchema.safeParse(chatImagesFormInput(fd));
  assert.ok(r.success);
  if (!r.success) return;
  assert.equal(r.data.query, 'Koji su rokovi?');
  assert.equal(r.data.chatId, undefined);
  assert.equal(r.data.images.length, 2);
});

test('chatImagesFormSchema: chatId mora biti UUID', () => {
  const fd = new FormData();
  fd.append('query', 'Pitanje');
  fd.append('chatId', 'nije-uuid');
  fd.append('images', jpegFile(buildJpeg()));
  assert.equal(chatImagesFormSchema.safeParse(chatImagesFormInput(fd)).success, false);
  fd.set('chatId', '3f2b8c1e-1111-4222-8333-444455556666');
  const ok = chatImagesFormSchema.safeParse(chatImagesFormInput(fd));
  assert.ok(ok.success);
  if (ok.success) assert.equal(ok.data.chatId, '3f2b8c1e-1111-4222-8333-444455556666');
});

test('chatImagesFormSchema: bez slika, previše slika, prazno pitanje, tekst umesto fajla', () => {
  const base = () => {
    const fd = new FormData();
    fd.append('query', 'Pitanje');
    return fd;
  };
  assert.equal(chatImagesFormSchema.safeParse(chatImagesFormInput(base())).success, false);

  const many = base();
  for (let i = 0; i <= MAX_IMAGES_PER_QUESTION; i++) many.append('images', jpegFile(buildJpeg()));
  const manyResult = chatImagesFormSchema.safeParse(chatImagesFormInput(many));
  assert.equal(manyResult.success, false);
  if (!manyResult.success) assert.match(manyResult.error.issues[0].message, /5/);

  const emptyQuery = new FormData();
  emptyQuery.append('query', '   ');
  emptyQuery.append('images', jpegFile(buildJpeg()));
  assert.equal(chatImagesFormSchema.safeParse(chatImagesFormInput(emptyQuery)).success, false);

  const text = base();
  text.append('images', 'nije fajl');
  assert.equal(chatImagesFormSchema.safeParse(chatImagesFormInput(text)).success, false);
});

test('chatImagesFormSchema: prazna slika, slika preko 800KB i zbir preko 4MB se odbijaju', () => {
  const one = (bytes: Uint8Array) => {
    const fd = new FormData();
    fd.append('query', 'Pitanje');
    fd.append('images', jpegFile(bytes));
    return chatImagesFormSchema.safeParse(chatImagesFormInput(fd));
  };
  assert.equal(one(new Uint8Array(0)).success, false);
  assert.equal(one(new Uint8Array(IMAGE_MAX_BYTES + 1)).success, false);
  assert.equal(one(new Uint8Array(IMAGE_MAX_BYTES)).success, true);
  // Zbir: 5 x 800KB = tačno 4MB je dozvoljeno (granica iz image-limits.ts je usaglašena)
  const fd = new FormData();
  fd.append('query', 'Pitanje');
  for (let i = 0; i < MAX_IMAGES_PER_QUESTION; i++) fd.append('images', jpegFile(new Uint8Array(IMAGE_MAX_BYTES)));
  assert.equal(chatImagesFormSchema.safeParse(chatImagesFormInput(fd)).success, IMAGE_MAX_BYTES * MAX_IMAGES_PER_QUESTION <= IMAGES_MAX_TOTAL_BYTES);
});

test('estimateTranscriptionTokens: slika + prompt + najveći izlaz prepisa', () => {
  assert.equal(estimateTranscriptionTokens(1568, 1176), estimateImageTokens(1568, 1176) + TRANSCRIBE_PROMPT_ALLOWANCE_TOKENS + TRANSCRIBE_MAX_OUTPUT_TOKENS);
});

test('parseTranscription: prazan odgovor i oznaka [NEMA TEKSTA] znače da teksta nema', () => {
  assert.equal(parseTranscription(''), null);
  assert.equal(parseTranscription('   \n '), null);
  assert.equal(parseTranscription(TRANSCRIPTION_EMPTY_MARKER), null);
  assert.equal(parseTranscription(`  ${TRANSCRIPTION_EMPTY_MARKER}\n`), null);
  assert.equal(parseTranscription('Član 1.\nUgovorne strane...'), 'Član 1.\nUgovorne strane...');
  // Oznaka usred pravog teksta nije prazna strana
  assert.equal(parseTranscription(`Član 1.\n${TRANSCRIPTION_EMPTY_MARKER}`), `Član 1.\n${TRANSCRIPTION_EMPTY_MARKER}`);
});

test('transcribeFormSchema: tačno jedna slika, ista ograničenja veličine', () => {
  const fd = new FormData();
  fd.append('image', jpegFile(buildJpeg()));
  assert.equal(transcribeFormSchema.safeParse(transcribeFormInput(fd)).success, true);
  assert.equal(transcribeFormSchema.safeParse(transcribeFormInput(new FormData())).success, false);
  const big = new FormData();
  big.append('image', jpegFile(new Uint8Array(IMAGE_MAX_BYTES + 1)));
  assert.equal(transcribeFormSchema.safeParse(transcribeFormInput(big)).success, false);
  const text = new FormData();
  text.append('image', 'nije fajl');
  assert.equal(transcribeFormSchema.safeParse(transcribeFormInput(text)).success, false);
});

test('transcriptIngestSchema: naziv, tekst do granice, broj strana 1-5, potvrda', () => {
  const ok = transcriptIngestSchema.safeParse({ title: '  Ugovor o zakupu ', text: ' Član 1. ', pages: 3 });
  assert.ok(ok.success);
  if (ok.success) assert.deepEqual(ok.data, { title: 'Ugovor o zakupu', text: 'Član 1.', pages: 3, acknowledge: false });
  assert.equal(transcriptIngestSchema.safeParse({ title: 'x', text: 'y', pages: 1, acknowledge: true }).success, true);
  for (const bad of [
    { title: '', text: 'y', pages: 1 },
    { title: 'x', text: '   ', pages: 1 },
    { title: 'x', text: 'y'.repeat(TRANSCRIPT_MAX_LENGTH + 1), pages: 1 },
    { title: 'x', text: 'y', pages: 0 },
    { title: 'x', text: 'y', pages: MAX_DOCUMENT_PAGES + 1 },
    { title: 'x', text: 'y', pages: 1.5 },
    { title: 'x', text: 'y', pages: '2' },
    { title: 'x'.repeat(201), text: 'y', pages: 1 },
    { title: 'x', text: 'y', pages: 1, acknowledge: 'true' },
  ]) {
    assert.equal(transcriptIngestSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));
  }
  assert.equal(transcriptIngestSchema.safeParse({ title: 'x', text: 'y'.repeat(TRANSCRIPT_MAX_LENGTH), pages: 5 }).success, true);
});
