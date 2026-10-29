import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, csvLine, toCsv, CSV_BOM, CSV_DELIMITER } from './csv.ts';

test('csvCell: običan tekst, brojevi i logičke vrednosti ostaju netaknuti', () => {
  assert.equal(csvCell('Zakon o radu'), 'Zakon o radu');
  assert.equal(csvCell('Čedomir Šćepanović'), 'Čedomir Šćepanović');
  assert.equal(csvCell(42), '42');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(true), 'true');
});

test('csvCell: prazne i nevažeće vrednosti daju praznu ćeliju', () => {
  for (const v of [null, undefined, NaN, Infinity, new Date('nije datum')]) assert.equal(csvCell(v), '', String(v));
});

test('csvCell: datum je ISO zapis (UTC)', () => {
  assert.equal(csvCell(new Date('2026-10-28T12:05:00Z')), '2026-10-28T12:05:00.000Z');
});

test('csvCell: ćelija sa razdvajačem, navodnikom ili prelomom reda ide u navodnike, a navodnici se udvostručuju', () => {
  assert.equal(CSV_DELIMITER, ';');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('kaže "da"'), '"kaže ""da"""');
  assert.equal(csvCell('red1\nred2'), '"red1\nred2"');
  assert.equal(csvCell('red1\r\nred2'), '"red1\r\nred2"');
});

test('csvCell: CSV injection: tekst koji počinje sa = + - @ tab CR ili LF dobija prefiks apostrofa', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@SUM(A1:A9)'), "'@SUM(A1:A9)");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('\rx'), '"\'\rx"');
  assert.equal(csvCell('\nx'), '"\'\nx"');
  assert.equal(csvCell('=HYPERLINK("http://evil","klik")'), '"\'=HYPERLINK(""http://evil"",""klik"")"');
});

test('csvCell: injection prefiks i navodnici rade zajedno, a prefiks se stavlja samo na početak', () => {
  assert.equal(csvCell('=a;b'), '"\'=a;b"');
  assert.equal(csvCell('a=b'), 'a=b');
  assert.equal(csvCell('Ana-Marija'), 'Ana-Marija');
  assert.equal(csvCell('ana@kancelarija.rs'), 'ana@kancelarija.rs');
});

test('csvCell: broj nije injection (negativan broj ostaje), a tekst "-5" jeste', () => {
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell('-5'), "'-5");
});

test('toCsv: BOM za Excel, zaglavlje, CRLF i završni prelom reda', () => {
  const out = toCsv(['Ime', 'Akcija'], [['Ana', '=1+1'], ['Čedomir', 'ok']]);
  assert.equal(out, "﻿Ime;Akcija\r\nAna;'=1+1\r\nČedomir;ok\r\n");
});

test('toCsv: zaglavlje se tretira kao i ostale ćelije, a prazna tabela ima samo zaglavlje', () => {
  assert.equal(toCsv(['A;B', '=x'], []), '﻿"A;B";\'=x\r\n');
});

test('csvLine: jedan red za strimovani izvoz, bez BOM-a, sa CRLF na kraju i istom zaštitom kao toCsv', () => {
  assert.equal(csvLine(['Ana', '=1+1', 7, null]), "Ana;'=1+1;7;\r\n");
  assert.equal(csvLine(['a;b']), '"a;b"\r\n');
});

test('CSV_BOM: UTF-8 BOM (U+FEFF) i toCsv je sastavlja od istih delova kao strim', () => {
  assert.equal(CSV_BOM, '﻿');
  const header = ['Ime', 'Akcija'];
  const rows = [['Ana', '=1+1'], ['Čedomir', 'ok']];
  assert.equal(toCsv(header, rows), CSV_BOM + [header, ...rows].map(csvLine).join(''));
});
