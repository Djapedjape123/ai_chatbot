// Mutacije čiste logike Faze 3, koraci 3.1 i 3.2 (lib/zip-directory.ts, lib/file-type.ts, lib/docx-inspect.ts).
// Svaka mora da obori bar jedan test. Pokretanje iz korena repozitorijuma:
//   node tools/verify/mutations-lib-3-1.mjs
// Pokreće samo testove ovih modula (brzo), sa vremenskim ograničenjem: mutacija koja napravi beskonačnu petlju
// računa se kao uhvaćena (to je ponašanje koje test mora da primeti).

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runMutations } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (name) => path.join(root, 'lib', name);
const zip = f('zip-directory.ts');
const type = f('file-type.ts');
const docx = f('docx-inspect.ts');

const mutations = [
  // --- zip-directory.ts
  { name: 'zip: kratak ulaz se ne odbija unapred', file: zip, from: 'if (bytes.byteLength < EOCD_LENGTH) return null;', to: '', equivalent: 'petlja u findEndOfCentralDirectory za kratak ulaz ne izvršava nijedan korak i vraća -1' },
  { name: 'zip: EOCD bez provere dužine komentara (lažan potpis u komentaru)', file: zip, from: 'pos + EOCD_LENGTH + view.getUint16(pos + 20, true) === view.byteLength', to: 'true' },
  { name: 'zip: broj diska se ne proverava', file: zip, from: 'if (disk !== 0 || directoryDisk', to: 'if (directoryDisk' },
  { name: 'zip: disk direktorijuma se ne proverava', file: zip, from: 'directoryDisk !== 0 || entriesOnDisk', to: 'entriesOnDisk' },
  { name: 'zip: stavke na disku i ukupno se ne porede', file: zip, from: ' || entriesOnDisk !== total) return null;', to: ') return null;' },
  { name: 'zip: ZIP64 oznake u EOCD-u se ne odbijaju', file: zip, from: 'if (total === ZIP64_16 || directorySize === ZIP64_32 || directoryOffset === ZIP64_32) return null;', to: '', equivalent: 'pokriveno proverom pomaka i završnom proverom `pos === eocd`' },
  { name: 'zip: pomak + veličina direktorijuma ne mora da završi na EOCD-u', file: zip, from: 'if (directoryOffset + directorySize !== eocd) return null;', to: '', equivalent: 'pokriveno završnom proverom `pos === eocd` i potpisom stavke' },
  { name: 'zip: potpis stavke se ne proverava', file: zip, from: 'if (view.getUint32(pos, true) !== CENTRAL_SIGNATURE) return null;', to: '' },
  { name: 'zip: zaglavlje stavke može da pređe EOCD', file: zip, from: 'if (pos + CENTRAL_HEADER_LENGTH > eocd) return null;', to: '', equivalent: 'na toj poziciji je potpis EOCD-a (ne stavke), a zaglavlje koje ipak stane pada na `next > eocd`' },
  { name: 'zip: ZIP64 oznake u stavci se ne odbijaju', file: zip, from: 'if (compressedSize === ZIP64_32 || uncompressedSize === ZIP64_32 || localHeaderOffset === ZIP64_32) return null;', to: '' },
  { name: 'zip: ime/extra/komentar mogu da pređu EOCD', file: zip, from: 'if (next > eocd) return null;', to: '', equivalent: 'čitanje je ograničeno `subarray`-em, a završna provera `pos === eocd` odbija takav direktorijum' },
  { name: 'zip: lokalno zaglavlje može da pokazuje na direktorijum', file: zip, from: 'if (localHeaderOffset + LOCAL_HEADER_LENGTH > directoryOffset) return null;', to: '' },
  { name: 'zip: višak bajtova posle poslednje stavke se prihvata', file: zip, from: 'return pos === eocd ? entries : null;', to: 'return entries;' },
  { name: 'zip: flagovi se ne čitaju', file: zip, from: 'flags: view.getUint16(pos + 8, true),', to: 'flags: 0,' },
  { name: 'zip: metod je uvek 8', file: zip, from: 'method: view.getUint16(pos + 10, true),', to: 'method: 8,' },
  { name: 'zip: spakovana veličina se čita sa pogrešnog mesta', file: zip, from: 'const compressedSize = view.getUint32(pos + 20, true);', to: 'const compressedSize = view.getUint32(pos + 24, true);' },
  { name: 'zip: pomak lokalnog zaglavlja se čita sa pogrešnog mesta', file: zip, from: 'const localHeaderOffset = view.getUint32(pos + 42, true);', to: 'const localHeaderOffset = view.getUint32(pos + 40, true);' },

  // --- file-type.ts
  { name: 'tip: prozor za %PDF- je 2048 bajta', file: type, from: 'const PDF_HEADER_WINDOW = 1024;', to: 'const PDF_HEADER_WINDOW = 2048;' },
  { name: 'tip: %PDF- sme da prelazi granicu od 1024 bajta', file: type, from: 'Math.min(PDF_HEADER_WINDOW - PDF_HEADER.length, bytes.length - PDF_HEADER.length)', to: 'Math.min(PDF_HEADER_WINDOW, bytes.length - PDF_HEADER.length)' },
  { name: 'tip: OLE potpis se ne prepoznaje', file: type, from: 'if (matchesAt(bytes, OLE_SIGNATURE, 0)) {', to: 'if (false) {' },
  { name: 'tip: šifrovan Office se vodi kao običan .doc', file: type, from: "return contains(bytes, ENCRYPTED_PACKAGE) ? 'encrypted_office' : 'legacy_doc';", to: "return 'legacy_doc';" },
  { name: 'tip: ZIP koji nije .docx propada na PDF proveru (poliglot)', file: type, from: "return isDocx(bytes) ? 'docx' : 'unknown';", to: "if (isDocx(bytes)) return 'docx';" },
  { name: 'tip: .docx ne traži word/document.xml', file: type, from: "const DOCX_REQUIRED_ENTRIES = ['[Content_Types].xml', 'word/document.xml'];", to: "const DOCX_REQUIRED_ENTRIES = ['[Content_Types].xml'];" },
  { name: 'tip: .docx traži samo jednu od dve stavke', file: type, from: 'return DOCX_REQUIRED_ENTRIES.every((name) => names.has(name));', to: 'return DOCX_REQUIRED_ENTRIES.some((name) => names.has(name));' },
  { name: 'tip: potpis koji tačno popunjava fajl se ne prepoznaje', file: type, from: 'at + pattern.length > bytes.length', to: 'at + pattern.length >= bytes.length' },
  { name: 'tip: EncryptedPackage na samom kraju fajla se ne vidi', file: type, from: 'const last = bytes.length - pattern.length;', to: 'const last = bytes.length - pattern.length - 1;' },

  // --- docx-inspect.ts: granice
  { name: 'docx: granica zbira 51MB', file: docx, from: 'export const DOCX_MAX_UNCOMPRESSED = 50 * 1024 * 1024;', to: 'export const DOCX_MAX_UNCOMPRESSED = 51 * 1024 * 1024;' },
  { name: 'docx: granica stavki 2001', file: docx, from: 'export const DOCX_MAX_ENTRIES = 2000;', to: 'export const DOCX_MAX_ENTRIES = 2001;' },
  { name: 'docx: granica odnosa 101', file: docx, from: 'export const DOCX_MAX_RATIO = 100;', to: 'export const DOCX_MAX_RATIO = 101;' },
  { name: 'docx: odnos se proverava od 64KB + 1', file: docx, from: 'const RATIO_MIN_ENTRY_SIZE = 64 * 1024;', to: 'const RATIO_MIN_ENTRY_SIZE = 64 * 1024 + 1;' },
  { name: 'docx: tačno 2000 stavki se odbija', file: docx, from: 'if (entries.length > DOCX_MAX_ENTRIES)', to: 'if (entries.length >= DOCX_MAX_ENTRIES)' },
  { name: 'docx: tačno 50MB se odbija', file: docx, from: 'if (declaredTotal > DOCX_MAX_UNCOMPRESSED)', to: 'if (declaredTotal >= DOCX_MAX_UNCOMPRESSED)' },
  { name: 'docx: stavka od tačno 64KB se ne proverava po odnosu', file: docx, from: 'e.uncompressedSize >= RATIO_MIN_ENTRY_SIZE', to: 'e.uncompressedSize > RATIO_MIN_ENTRY_SIZE' },
  { name: 'docx: tačno 100:1 se odbija', file: docx, from: 'e.uncompressedSize > e.compressedSize * DOCX_MAX_RATIO', to: 'e.uncompressedSize >= e.compressedSize * DOCX_MAX_RATIO' },
  { name: 'docx: odnos se uopšte ne proverava', file: docx, from: 'if (e.uncompressedSize >= RATIO_MIN_ENTRY_SIZE && e.uncompressedSize > e.compressedSize * DOCX_MAX_RATIO) {', to: 'if (false) {' },
  { name: 'docx: zbir se računa od spakovanih veličina', file: docx, from: 'sum + e.uncompressedSize', to: 'sum + e.compressedSize' },

  // --- docx-inspect.ts: imena stavki
  { name: 'docx: makro samo kao vbaProject.bin na kraju imena', file: docx, from: "n.includes('vbaproject')", to: "n.endsWith('vbaproject.bin')" },
  { name: 'docx: vbaData.xml nije makro', file: docx, from: " || n.endsWith('vbadata.xml')", to: '' },
  { name: 'docx: oleObject van embeddings se ne hvata', file: docx, from: "n.includes('oleobject') || ", to: '' },
  { name: 'docx: svaki fajl u embeddings je ugrađen objekat', file: docx, from: "(path.includes('/embeddings/') && n.endsWith('.bin'))", to: "path.includes('/embeddings/')" },
  { name: 'docx: svaki .bin je ugrađen objekat', file: docx, from: "(path.includes('/embeddings/') && n.endsWith('.bin'))", to: "(path.includes('/embeddings/') || n.endsWith('.bin'))" },
  { name: 'docx: ActiveX se ne hvata', file: docx, from: "if (path.includes('/activex/')) return 'docx_activex';", to: '' },
  { name: 'docx: obrnute kose crte se ne normalizuju', file: docx, from: "let n = name.replace(/\\\\/g, '/');", to: 'let n = name;' },
  { name: 'docx: %-kodiranje imena se ne dekodira', file: docx, from: 'n = decodeURIComponent(n);', to: '' },
  { name: 'docx: velika slova u imenu se ne spuštaju', file: docx, from: 'return n.toLowerCase();', to: 'return n;' },
  { name: 'docx: imena stavki se ne proveravaju', file: docx, from: 'const finding = activeContentByName(e.name);', to: 'const finding = null;' },

  // --- docx-inspect.ts: kodiranje XML-a i entiteti
  { name: 'docx: UTF-16LE sa BOM-om se čita kao UTF-8', file: docx, from: "if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));", to: '' },
  { name: 'docx: UTF-16BE sa BOM-om se čita kao UTF-8', file: docx, from: "if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));", to: '' },
  { name: 'docx: UTF-16LE bez BOM-a se čita kao UTF-8', file: docx, from: "if (bytes.length >= 2 && bytes[0] === 0x3c && bytes[1] === 0x00) return new TextDecoder('utf-16le').decode(bytes);", to: '' },
  { name: 'docx: UTF-16BE bez BOM-a se čita kao UTF-8', file: docx, from: "if (bytes.length >= 2 && bytes[0] === 0x00 && bytes[1] === 0x3c) return new TextDecoder('utf-16be').decode(bytes);", to: '' },
  { name: 'docx: imenovani entiteti se ne dekodiraju', file: docx, from: 'if (named) return NAMED_ENTITIES[named] ?? whole;', to: 'if (named) return whole;', equivalent: 'imenovani entiteti (amp, lt, gt, quot, apos) ne mogu da napišu slova koja proveravamo' },
  { name: 'docx: heksadecimalni entiteti se ne dekodiraju', file: docx, from: 'const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);', to: 'const code = parseInt(dec, 10);' },
  { name: 'docx: ogroman entitet baca izuzetak', file: docx, from: 'return code <= 0x10ffff ? String.fromCodePoint(code) : whole;', to: 'return String.fromCodePoint(code);' },

  // --- docx-inspect.ts: čitanje veza
  { name: 'docx: komentar u XML-u se ne preskače', file: docx, from: "if (xml.startsWith('!--', i)) {", to: 'if (false) {' },
  { name: 'docx: CDATA se ne preskače (veza u CDATA se računa kao prava)', file: docx, from: "if (xml.startsWith('![CDATA[', i)) {", to: 'if (false) {' },
  { name: 'docx: instrukcija obrade (<?...?>) se ne preskače', file: docx, from: "if (xml[i] === '?' || xml[i] === '!') {", to: 'if (false) {' },
  { name: 'docx: prefiks prostora imena se ne skida', file: docx, from: 'const local = tag.slice(tag.lastIndexOf(\':\') + 1).toLowerCase();', to: 'const local = tag.toLowerCase();' },
  { name: 'docx: entiteti u atributima se ne dekodiraju', file: docx, from: 'attrs.set(attr, decodeEntities(value).trim());', to: 'attrs.set(attr, value.trim());' },
  { name: 'docx: razmaci oko vrednosti atributa se ne skidaju', file: docx, from: 'attrs.set(attr, decodeEntities(value).trim());', to: 'attrs.set(attr, decodeEntities(value));', equivalent: 'XML ne dozvoljava razmake oko vrednosti, pa Word takvu vezu ne bi tumačio kao External' },
  { name: 'docx: TargetMode se poredi osetljivo na velika slova', file: docx, from: "(rel.get('targetmode') ?? '').toLowerCase() !== 'external'", to: "(rel.get('targetmode') ?? '') !== 'external'" },
  { name: 'docx: unutrašnje veze se računaju kao udaljene', file: docx, from: "if ((rel.get('targetmode') ?? '').toLowerCase() !== 'external') continue;", to: '' },
  { name: 'docx: tip veze se poredi osetljivo na velika slova', file: docx, from: "const type = (rel.get('type') ?? '').toLowerCase();", to: "const type = (rel.get('type') ?? '');" },
  { name: 'docx: udaljeni oleObject se javlja kao šablon', file: docx, from: "if (kind === 'oleobject') return 'docx_remote_object';", to: "if (kind === 'oleobject') return 'docx_remote_template';" },
  { name: 'docx: udaljeni frame se javlja kao objekat', file: docx, from: "if (kind === 'frame') return 'docx_remote_frame';", to: "if (kind === 'frame') return 'docx_remote_object';" },
  { name: 'docx: udaljeni šablon se ne hvata', file: docx, from: "if (kind === 'attachedtemplate') return 'docx_remote_template';", to: '' },

  // --- docx-inspect.ts: raspakivanje i provera sadržaja
  { name: 'docx: potpis lokalnog zaglavlja se ne proverava', file: docx, from: ' || view.getUint32(at, true) !== LOCAL_SIGNATURE', to: '' },
  { name: 'docx: lokalno zaglavlje van fajla se ne proverava', file: docx, from: 'at + LOCAL_HEADER_LENGTH > bytes.length || ', to: '', equivalent: 'readZipDirectory već garantuje localHeaderOffset + 30 <= pomak direktorijuma <= dužina fajla' },
  { name: 'docx: podaci van fajla se ne proveravaju', file: docx, from: 'if (end > bytes.length) return { ok: false, rejection: unreadable(\'zip_data_out_of_range\') };', to: '' },
  { name: 'docx: stavka bez kompresije prolazi i kad se veličine ne slažu', file: docx, from: 'return packed.length === entry.uncompressedSize ? { ok: true, data: packed } : mismatch;', to: 'return { ok: true, data: packed };' },
  { name: 'docx: izlaz bez ograničenja za praznu stavku (maxOutputLength 0)', file: docx, from: 'Math.max(1, entry.uncompressedSize)', to: 'entry.uncompressedSize' },
  { name: 'docx: stvarna veličina se ne poredi sa deklarisanom', file: docx, from: 'return data.length === entry.uncompressedSize ? { ok: true, data } : mismatch;', to: 'return { ok: true, data };' },
  { name: 'docx: prekoračen izlaz se javlja kao oštećen tok', file: docx, from: 'if (error instanceof RangeError) return mismatch; // izlaz je veći od deklarisanog', to: '' },
  { name: 'docx: šifrovana stavka se ne odbija', file: docx, from: "if ((e.flags & 0x0001) !== 0) return unreadable('zip_encrypted_entry');", to: '' },
  { name: 'docx: nepoznat metod kompresije se ne odbija', file: docx, from: "if (e.method !== 0 && e.method !== 8) return unreadable('zip_method');", to: '' },
  { name: 'docx: preveliki XML deo se ne odbija', file: docx, from: "if (unpacked.data.length > MAX_META_PART_SIZE) return unreadable('xml_part_too_large');", to: '' },
  { name: 'docx: granica XML dela 50MB', file: docx, from: 'const MAX_META_PART_SIZE = 5 * 1024 * 1024;', to: 'const MAX_META_PART_SIZE = 50 * 1024 * 1024;' },
  { name: 'docx: DTD se ne odbija', file: docx, from: "if (/<!doctype/i.test(text)) return unreadable('xml_dtd');", to: '' },
  { name: 'docx: Content Types se ne prepoznaje (mala slova)', file: docx, from: "const isContentTypes = name === '[content_types].xml';", to: "const isContentTypes = name === '[Content_Types].xml';" },
  { name: 'docx: .rels samo iz word/_rels', file: docx, from: "const isRels = name.endsWith('.rels');", to: "const isRels = name.startsWith('word/_rels/');" },
  { name: 'docx: Content Types i veze zamenjeni', file: docx, from: '(isContentTypes ? xmlParts : relParts).push(text);', to: '(isContentTypes ? relParts : xmlParts).push(text);' },
  { name: 'docx: macroEnabled se ne traži', file: docx, from: "lower.includes('macroenabled') || ", to: '' },
  { name: 'docx: vbaProject u tipu sadržaja se ne traži', file: docx, from: " || lower.includes('vbaproject')", to: '' },
  { name: 'docx: entiteti u Content Types se ne dekodiraju', file: docx, from: 'const lower = decodeEntities(text).toLowerCase();', to: 'const lower = text.toLowerCase();' },
];

const files = ['zip-directory', 'file-type', 'docx-inspect', 'validation'].map((n) => `lib/${n}.test.ts`);

function runTests() {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--test', ...files], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 90_000,
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { failed: true, detail: 'vremensko ograničenje (petlja?)' };
  const names = [...(r.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  return { failed: r.status !== 0, detail: names.slice(0, 2).join(' | ').slice(0, 110) };
}

// Opciono: `node tools/verify/mutations-lib-3-1.mjs <deo imena>` pušta samo mutacije čije ime sadrži taj tekst
const only = process.argv[2];
const selected = only ? mutations.filter((m) => m.name.includes(only)) : mutations;

const { results, intact } = await runMutations(selected, runTests, { label: 'Mutacije lib/ (3.1 i 3.2)' });
const bad = results.filter((r) => r.status !== 'UHVAĆENA' && !r.equivalent);
process.exit(intact && bad.length === 0 ? 0 : 1);
