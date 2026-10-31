// Pravi bezopasne PROBNE fajlove za ručnu proveru Faze 3 na Vercelu (korak 3.8). Nijedan nema pravi malver:
// "JavaScript" je app.alert(1), "makro" je samo ime stavke u arhivi, a "bomba" je 60MB nula u ~60KB.
//
// Pokretanje iz korena repozitorijuma:
//   node --experimental-strip-types --disable-warning=ExperimentalWarning tools/verify/make-sample-files.mjs <folder>
// npr. folder: C:\Users\Pedja\Desktop\probni-fajlovi

import fs from 'node:fs';
import path from 'node:path';
import { basePdf, basePdfObjects, buildPdf } from '../../lib/test-support/pdf-builder.ts';
import { OLE_SIGNATURE, buildDocx, joinBytes, utf16le } from '../../lib/test-support/zip-builder.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('Upotreba: node --experimental-strip-types tools/verify/make-sample-files.mjs <folder>');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });

const JS = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';
const MB = 1024 * 1024;

// Svaki fajl: [ime, bajtovi, šta očekuješ]
const files = [
  ['01-ispravan.pdf', basePdf({ text: 'Zakon o obligacionim odnosima, probni dokument' }), 'PROLAZI (PDF u bazu znanja)'],
  ['02-ispravan.docx', buildDocx(), 'PROLAZI (Word u bazu znanja ili kao prilog uz pitanje)'],
  ['03-pdf-300-strana.pdf', basePdf({ pages: 300 }), 'PROLAZI (granica je 300 strana); pogledaj koliko traje'],
  ['10-pdf-301-strana.pdf', basePdf({ pages: 301 }), 'ODBIJEN: previše strana (301, a najviše je 300)'],
  ['11-pdf-sa-javascript.pdf', buildPdf(basePdfObjects({ catalogExtra: `/OpenAction ${JS}` })), 'ODBIJEN: aktivan sadržaj (JavaScript u PDF-u)'],
  ['12-pdf-sa-lozinkom.pdf', basePdf({ encrypt: { userPassword: 'tajna' } }), 'ODBIJEN: PDF zaštićen lozinkom'],
  ['13-pdf-bez-teksta.pdf', basePdf({ text: '' }), 'ODBIJEN: nema teksta (skeniran)'],
  ['14-docx-sa-makroom.docx', buildDocx([{ name: 'word/vbaProject.bin', data: 'MZ' }]), 'ODBIJEN: aktivan sadržaj (makroi)'],
  [
    '15-docx-udaljeni-sablon.docx',
    buildDocx([
      {
        name: 'word/_rels/settings.xml.rels',
        data:
          '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://primer.invalid/sablon.dotm" TargetMode="External"/></Relationships>',
      },
    ]),
    'ODBIJEN: aktivan sadržaj (šablon koji se učitava sa interneta)',
  ],
  ['16-docx-bomba.docx', buildDocx([{ name: 'word/media/bomba.txt', data: new Uint8Array(60 * MB) }]), 'ODBIJEN: neobično velik kad se raspakuje'],
  ['17-stari-word.doc', joinBytes(OLE_SIGNATURE, new Uint8Array(1024)), 'ODBIJEN: stari .doc format (uputstvo: sačuvaj kao .docx)'],
  [
    '18-word-sa-lozinkom.docx',
    joinBytes(OLE_SIGNATURE, new Uint8Array(900), utf16le('EncryptionInfo'), new Uint8Array(30), utf16le('EncryptedPackage')),
    'ODBIJEN: Word zaštićen lozinkom',
  ],
  ['19-tekst-kao-pdf.pdf', new TextEncoder().encode('Ovo je običan tekst, preimenovan u .pdf.'), 'ODBIJEN: tip fajla nije podržan'],
];

for (const [name, bytes] of files) fs.writeFileSync(path.join(dir, name), bytes);

console.log(`Napravljeno ${files.length} fajlova u ${path.resolve(dir)}:\n`);
for (const [name, bytes, expected] of files) console.log(`  ${name.padEnd(32)} ${String(Math.round(bytes.length / 1024)).padStart(6)} KB   ${expected}`);
