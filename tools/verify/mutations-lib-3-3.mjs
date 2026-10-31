// Mutacije čiste logike Faze 3, korak 3.3 (lib/pdf-inspect.ts, lib/pdf-read.ts). Svaka mora da obori bar jedan test.
// Pokretanje iz korena repozitorijuma:
//   node tools/verify/mutations-lib-3-3.mjs [deo imena mutacije]
// Pušta samo testove ovih modula, sa vremenskim ograničenjem (petlja = uhvaćena).

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (name) => path.join(root, 'lib', name);
const insp = f('pdf-inspect.ts');
const read = f('pdf-read.ts');

const mutations = [
  // --- pdf-inspect.ts: granice
  { name: 'pdf: granica strana 301', file: insp, from: 'export const PDF_MAX_PAGES = 300;', to: 'export const PDF_MAX_PAGES = 301;' },
  { name: 'pdf: budžet tokova objekata 100MB', file: insp, from: 'export const PDF_MAX_OBJECT_STREAM_BYTES = 50 * 1024 * 1024;', to: 'export const PDF_MAX_OBJECT_STREAM_BYTES = 100 * 1024 * 1024;' },

  // --- pdf-inspect.ts: spisak opasnih imena
  { name: 'pdf: /JavaScript nije opasno ime', file: insp, from: "['JavaScript', 'pdf_javascript'],", to: '' },
  { name: 'pdf: /JS nije opasno ime', file: insp, from: "['JS', 'pdf_javascript'],", to: '' },
  { name: 'pdf: /Launch nije opasno ime', file: insp, from: "['Launch', 'pdf_launch'],", to: '' },
  { name: 'pdf: /EmbeddedFile nije opasno ime', file: insp, from: "['EmbeddedFile', 'pdf_embedded_file'],", to: '' },
  { name: 'pdf: /EmbeddedFiles nije opasno ime', file: insp, from: "['EmbeddedFiles', 'pdf_embedded_file'],", to: '' },
  { name: 'pdf: /RichMedia nije opasno ime', file: insp, from: "['RichMedia', 'pdf_rich_media'],", to: '' },
  { name: 'pdf: /XFA nije opasno ime', file: insp, from: "['XFA', 'pdf_xfa'],", to: '' },
  { name: 'pdf: /SubmitForm nije opasno ime', file: insp, from: "['SubmitForm', 'pdf_submit_form'],", to: '' },
  { name: 'pdf: /ImportData nije opasno ime', file: insp, from: "['ImportData', 'pdf_import_data'],", to: '' },
  { name: 'pdf: /Launch se prijavljuje kao JavaScript', file: insp, from: "['Launch', 'pdf_launch'],", to: "['Launch', 'pdf_javascript']," },
  { name: 'pdf: poređenje imena preko prefiksa (startsWith)', file: insp, from: 'const finding = DANGEROUS_NAMES.get(name);', to: "const finding = [...DANGEROUS_NAMES].find(([k]) => name.startsWith(k))?.[1];" },

  // --- pdf-inspect.ts: čitanje imena
  { name: 'pdf: #xx se ne dekodira', file: insp, from: 'if (data[k] === 0x23 && k + 2 < to) {', to: 'if (false) {' },
  { name: 'pdf: #xx dekodiranje čita i bajt van imena', file: insp, from: 'if (data[k] === 0x23 && k + 2 < to) {', to: 'if (data[k] === 0x23 && k + 2 <= to) {', equivalent: 'bajt iza imena je razmak ili delimiter (nije heks cifra), pa se čita doslovno' },
  { name: 'pdf: vrednost #xx bez nižeg nibble-a', file: insp, from: 'name += String.fromCharCode(hi * 16 + lo);', to: 'name += String.fromCharCode(hi * 16);' },
  { name: 'pdf: #xx ne preskače cifre', file: insp, from: '        k += 2;\n        continue;', to: '        continue;' },
  { name: 'pdf: velika slova heks cifara se ne prepoznaju', file: insp, from: 'if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;', to: '' },
  { name: 'pdf: mala slova heks cifara se ne prepoznaju', file: insp, from: 'if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;', to: '' },
  { name: 'pdf: cifre heks zapisa se ne prepoznaju', file: insp, from: 'if (c >= 0x30 && c <= 0x39) return c - 0x30;', to: '' },
  { name: 'pdf: granica dužine imena 1 (sva imena se preskaču)', file: insp, from: 'const MAX_NAME_LENGTH = 64;', to: 'const MAX_NAME_LENGTH = 1;' },
  { name: 'pdf: dužina imena `<` umesto `<=`', file: insp, from: 'if (j - (i + 1) <= MAX_NAME_LENGTH) {', to: 'if (j - (i + 1) < MAX_NAME_LENGTH) {', equivalent: 'nijedno opasno ime nije duže od 13 znakova, pa granica od 64 samo štiti od skupe obrade' },

  // --- pdf-inspect.ts: preskakanje stringova, komentara i tokova
  { name: 'pdf: komentari se ne preskaču', file: insp, from: '} else if (c === 0x25) {', to: '} else if (false) {' },
  { name: 'pdf: literalni stringovi se ne preskaču', file: insp, from: '} else if (c === 0x28) {\n      i = skipLiteralString(data, i);', to: '} else if (false) {\n      i = skipLiteralString(data, i);' },
  { name: 'pdf: zagrade u stringu se ne gnezde', file: insp, from: 'else if (c === 0x29 && --depth === 0) return i + 1;', to: 'else if (c === 0x29) return i + 1;' },
  { name: 'pdf: obrnuta kosa crta u stringu ne štiti sledeći bajt', file: insp, from: 'i += 2; // obrnuta kosa crta "pojede" sledeći bajt, i zagradu', to: 'i += 1;' },
  { name: 'pdf: heks stringovi se ne preskaču', file: insp, from: 'const end = data.indexOf(0x3e, i + 1); // heksadecimalni string\n        i = end === -1 ? n : end + 1;', to: 'i += 1;', equivalent: 'heks string sadrži samo cifre i razmake, nema kosu crtu, pa ne može da nosi ime' },
  { name: 'pdf: početak rečnika "<<" se čita kao jedan znak', file: insp, from: 'i += 2; // početak rečnika', to: 'i += 1;' },
  { name: 'pdf: tokovi se ne preskaču (ključna reč stream se ne prepoznaje)', file: insp, from: "const token = length === 3 || length === 6 ? latin1(data, i, j) : '';", to: "const token = '';" },
  { name: 'pdf: posle stream se ne preskače prelom reda', file: insp, from: 'if (data[i] === 0x0d && data[i + 1] === 0x0a) i += 2;\n        else if (data[i] === 0x0a || data[i] === 0x0d) i += 1;', to: '' },
  { name: 'pdf: kraj toka bez endstream se tretira kao greška (-1)', file: insp, from: 'const dataEnd = end === -1 ? n : end;', to: 'const dataEnd = end;' },
  { name: 'pdf: posle toka se ne prelazi preko endstream', file: insp, from: 'i = end === -1 ? n : end + END_STREAM.length;', to: 'i = end === -1 ? n : end;', equivalent: '"endstream" je običan token od 9 znakova koji čitač ionako ignoriše' },
  { name: 'pdf: imena objekta se ne beleže', file: insp, from: 'objectNames.add(name);', to: '' },
  { name: 'pdf: imena objekta se ne brišu na obj/endobj', file: insp, from: "if (token === 'obj' || token === 'endobj') {\n        objectNames = new Set();", to: "if (token === 'obj' || token === 'endobj') {" },
  { name: 'pdf: imena objekta se ne brišu posle toka', file: insp, from: 'i = end === -1 ? n : end + END_STREAM.length;\n        objectNames = new Set();', to: 'i = end === -1 ? n : end + END_STREAM.length;', equivalent: 'imena objekta se brišu i na ključnoj reči endobj, koja uvek sledi toku' },
  { name: 'pdf: raspakuje se svaki tok, ne samo ObjStm', file: insp, from: "if (depth === 0 && objectNames.has('ObjStm')) {", to: 'if (depth === 0) {' },
  { name: 'pdf: ObjStm se nikad ne čita', file: insp, from: "if (depth === 0 && objectNames.has('ObjStm')) {", to: 'if (false) {' },
  { name: 'pdf: čitanje i u ugnježdenom sadržaju', file: insp, from: "if (depth === 0 && objectNames.has('ObjStm')) {", to: "if (objectNames.has('ObjStm')) {" },
  { name: 'pdf: Flate ObjStm se skenira bez raspakivanja', file: insp, from: "if (objectNames.has('FlateDecode')) inner = scanObjectStream(body, budget);", to: "if (objectNames.has('FlateDecode')) inner = scanBuffer(body, budget, 1);" },
  { name: 'pdf: ObjStm bez filtera se ne skenira', file: insp, from: "else if (!objectNames.has('Filter')) inner = scanBuffer(body, budget, 1);", to: '' },
  { name: 'pdf: ObjStm sa bilo kojim drugim filterom se skenira kao tekst', file: insp, from: "else if (!objectNames.has('Filter')) inner = scanBuffer(body, budget, 1);", to: 'else inner = scanBuffer(body, budget, 1);' },
  { name: 'pdf: bomba se ne prepoznaje kad je budžet 0', file: insp, from: 'if (budget.remaining <= 0) return', to: 'if (budget.remaining < 0) return', equivalent: 'inflate sa maxOutputLength 0 baca RangeError, što se takođe javlja kao bomba' },
  { name: 'pdf: prekoračenje izlaza se ne računa kao bomba', file: insp, from: "return error instanceof RangeError ? { kind: 'archive_bomb', finding: 'pdf_object_stream_too_large' } : CLEAN;", to: 'return CLEAN;' },
  { name: 'pdf: oštećen ObjStm se računa kao bomba', file: insp, from: "return error instanceof RangeError ? { kind: 'archive_bomb', finding: 'pdf_object_stream_too_large' } : CLEAN;", to: "return { kind: 'archive_bomb', finding: 'pdf_object_stream_too_large' };" },
  { name: 'pdf: budžet se ne troši između tokova', file: insp, from: 'budget.remaining -= inflated.length;', to: '' },
  { name: 'pdf: raspakovan sadržaj ObjStm-a se ne skenira', file: insp, from: 'return scanBuffer(inflated, budget, 1);', to: 'return CLEAN;' },
  { name: 'pdf: rezultat unutrašnjeg skeniranja se ignoriše', file: insp, from: "if (inner.kind !== 'clean') return inner;", to: '' },
  { name: 'pdf: početni budžet 0', file: insp, from: 'return scanBuffer(bytes, { remaining: PDF_MAX_OBJECT_STREAM_BYTES }, 0);', to: 'return scanBuffer(bytes, { remaining: 0 }, 0);' },

  // --- pdf-inspect.ts: sloj (b)
  { name: 'pdf (b): JavaScript dokumenta se ne proverava', file: insp, from: "if (hasKeys(await pdf.getJSActions())) return 'pdf_javascript';", to: '', equivalent: 'hasJSActions() pdf.js vraća true i za JavaScript na nivou dokumenta (OpenAction, stablo imena); provera je jasnija i jeftina' },
  { name: 'pdf (b): JavaScript polja se ne proverava', file: insp, from: "if (await pdf.hasJSActions()) return 'pdf_javascript';", to: '' },
  { name: 'pdf (b): prilozi dokumenta se ne proveravaju', file: insp, from: "if (attachments && attachments.size > 0) return 'pdf_embedded_file';", to: '' },
  { name: 'pdf (b): poslednja strana se ne proverava', file: insp, from: 'number <= pdf.numPages', to: 'number < pdf.numPages' },
  { name: 'pdf (b): JavaScript strane se ne proverava', file: insp, from: "if (hasKeys(await page.getJSActions())) return 'pdf_javascript';", to: '' },
  { name: 'pdf (b): anotacija priloga se ne proverava', file: insp, from: "if (annotation.subtype === 'FileAttachment') return 'pdf_embedded_file';", to: '' },
  { name: 'pdf (b): RichMedia anotacija se ne proverava', file: insp, from: "if (annotation.subtype === 'RichMedia') return 'pdf_rich_media';", to: '' },
  { name: 'pdf (b): akcije anotacije se ne proveravaju', file: insp, from: "if (hasKeys(annotation.actions)) return 'pdf_javascript';", to: '' },
  { name: 'pdf (b): prazan objekat se računa kao nalaz', file: insp, from: "typeof value === 'object' && value !== null && Object.keys(value).length > 0", to: "typeof value === 'object' && value !== null", equivalent: 'pdf.js vraća null kad nema akcija; provera ključeva štiti od praznog objekta (lažno pozitivno)' },

  // --- pdf-read.ts
  { name: 'read: struktura se ne skenira pre otvaranja', file: read, from: "if (scan.kind === 'active_content') return { ok: false, reason: 'active_content', finding: scan.finding };", to: '' },
  { name: 'read: bomba iz strukture se ne odbija', file: read, from: "if (scan.kind === 'archive_bomb') return { ok: false, reason: 'archive_bomb', finding: scan.finding };", to: '' },
  { name: 'read: pdf.js dobija originalni bafer (prazni ga)', file: read, from: 'pdf = await getDocumentProxy(bytes.slice());', to: 'pdf = await getDocumentProxy(bytes);' },
  { name: 'read: šifrovan PDF se javlja kao oštećen', file: read, from: "if (error instanceof Error && error.name === 'PasswordException') return { ok: false, reason: 'encrypted_pdf' };", to: '' },
  { name: 'read: svaka greška otvaranja je šifrovan PDF', file: read, from: "if (error instanceof Error && error.name === 'PasswordException') return { ok: false, reason: 'encrypted_pdf' };", to: "return { ok: false, reason: 'encrypted_pdf' };" },
  { name: 'read: granica strana se ne proverava', file: read, from: "if (pdf.numPages > PDF_MAX_PAGES) return { ok: false, reason: 'too_many_pages', pages: pdf.numPages };", to: '' },
  { name: 'read: tačno 300 strana se odbija', file: read, from: 'if (pdf.numPages > PDF_MAX_PAGES)', to: 'if (pdf.numPages >= PDF_MAX_PAGES)' },
  { name: 'read: pdf.js pregled dokumenta se preskače', file: read, from: "if (finding) return { ok: false, reason: 'active_content', finding };", to: '' },
  { name: 'read: pregled dokumenta posle izvlačenja teksta', file: read, from: 'const finding = await inspectPdfDocument(pdf);\n    if (finding) return { ok: false, reason: \'active_content\', finding };\n\n    const { text } = await extractText(pdf, { mergePages: true });', to: 'const { text } = await extractText(pdf, { mergePages: true });\n    const finding = await inspectPdfDocument(pdf);\n    if (finding) return { ok: false, reason: \'active_content\', finding };' , equivalent: 'rezultat je isti; razlika je samo u potrošnji CPU-a pre odbijanja' },
  { name: 'read: greška čitanja teksta se ne hvata', file: read, from: '  } catch {\n    return { ok: false, reason: \'unreadable_pdf\' };\n  } finally {', to: '  } finally {' },
  { name: 'read: tekst se vraća bez trim-a broja strana (pages 0)', file: read, from: 'return { ok: true, text, pages: pdf.numPages };', to: 'return { ok: true, text, pages: 0 };' },
];

const files = ['pdf-inspect', 'pdf-read'].map((n) => `lib/${n}.test.ts`);

function runTests() {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--test', ...files], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { failed: true, detail: 'vremensko ograničenje (petlja?)' };
  const names = [...(r.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  return { failed: r.status !== 0, detail: names.slice(0, 2).join(' | ').slice(0, 110) };
}

const only = process.argv[2];
const selected = only ? mutations.filter((m) => m.name.includes(only)) : mutations;

const { results, intact } = await runMutations(selected, runTests, { label: 'Mutacije lib/ (3.3)' });
const bad = results.filter((r) => r.status !== 'UHVAĆENA' && !r.equivalent);
process.exit(intact && bad.length === 0 ? 0 : 1);
