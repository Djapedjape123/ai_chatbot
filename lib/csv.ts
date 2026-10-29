// CSV izvoz dnevnika aktivnosti (admin panel, 2.5.7). Čist kod bez server-only importa, da bi se mogao testirati.

// Excel na srpskom Windows-u očekuje ";" kao razdvajač liste (zarez je tamo decimalni znak), pa bi CSV
// sa zarezima otvorio sve u jednoj koloni. Zato je razdvajač ";", a ćelije sa zarezom se i dalje stavljaju u navodnike.
export const CSV_DELIMITER = ';';

// UTF-8 BOM da Excel ispravno prikaže č, ć, š, ž, đ
export const CSV_BOM = '﻿';

export type CsvValue = string | number | boolean | Date | null | undefined;

// CSV injection: ćelija koja počinje ovim znakovima Excel/LibreOffice tumači kao formulu (=HYPERLINK, =cmd|...).
// Prefiks apostrofa je pretvara u običan tekst. Brojevi (tip number) su bezbedni i ostaju kakvi jesu.
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n']);

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);

  const text = FORMULA_TRIGGERS.has(value[0]) ? `'${value}` : value;
  return /[";,\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// Jedan red sa završnim CRLF. Strimovani izvoz šalje red po red, a toCsv ga sastavlja od istih delova.
export function csvLine(cells: CsvValue[]): string {
  return `${cells.map(csvCell).join(CSV_DELIMITER)}\r\n`;
}

export function toCsv(header: string[], rows: CsvValue[][]): string {
  return CSV_BOM + [header, ...rows].map(csvLine).join('');
}
