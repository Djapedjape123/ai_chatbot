// Mutacije čiste logike 2.5.7 i 2.5.8 (lib/*.ts). Svaka mora da obori bar jedan test iz `npm test`.
// Pokretanje iz korena repozitorijuma: node tools/verify/mutations-lib-2-5-7.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutations, runUnitTests } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (name) => path.join(root, 'lib', name);

const mutations = [
  // --- belgrade-time.ts
  { name: 'pomak sata sa pogrešnim znakom', file: f('belgrade-time.ts'), from: 'return asUtc - Math.floor(instant.getTime() / 1000) * 1000;', to: 'return Math.floor(instant.getTime() / 1000) * 1000 - asUtc;' },
  { name: 'daysInclusive bez "+ 1" (jedan dan manje)', file: f('belgrade-time.ts'), from: 'return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS) + 1;', to: 'return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS);' },
  { name: 'isRealDate prihvata sve u obliku GGGG-MM-DD', file: f('belgrade-time.ts'), from: 'return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;', to: 'return true;' },
  { name: 'belgradeDateOf koristi UTC datum', file: f('belgrade-time.ts'), from: 'return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;', to: 'return instant.toISOString().slice(0, 10);' },
  { name: 'addDays pomera za 23 sata (računa sa satom)', file: f('belgrade-time.ts'), from: 'return utcMsToDate(dateToUtcMs(date) + days * DAY_MS);', to: 'return utcMsToDate(dateToUtcMs(date) + days * (DAY_MS - 3_600_000));' },
  {
    name: 'belgradeMidnightUtc bez drugog prolaza',
    file: f('belgrade-time.ts'),
    from: 'return new Date(naive - offsetMs(new Date(first)));',
    to: 'return new Date(first);',
    equivalent: 'prelazi sata su u 01:00 UTC, pa je pomak u ponoć uvek isti u oba prolaza; drugi prolaz je samo odbrana',
  },

  // --- audit-filter.ts
  { name: 'podrazumevani period 6 dana umesto 7', file: f('audit-filter.ts'), from: 'export const AUDIT_DEFAULT_DAYS = 7;', to: 'export const AUDIT_DEFAULT_DAYS = 6;' },
  { name: 'granica od 90 dana isključuje 90', file: f('audit-filter.ts'), from: 'daysInclusive(fromDate, toDate) > AUDIT_MAX_DAYS', to: 'daysInclusive(fromDate, toDate) >= AUDIT_MAX_DAYS' },
  { name: 'kraj perioda je ponoć PRE toDate (poslednji dan se gubi)', file: f('audit-filter.ts'), from: 'belgradeMidnightUtc(addDays(toDate, 1)).toISOString()', to: 'belgradeMidnightUtc(toDate).toISOString()' },
  {
    name: '90 dana se računa u satima, a ne u kalendarskim danima',
    file: f('audit-filter.ts'),
    from: 'daysInclusive(fromDate, toDate) > AUDIT_MAX_DAYS',
    to: '(belgradeMidnightUtc(addDays(toDate, 1)).getTime() - belgradeMidnightUtc(fromDate).getTime()) / 86_400_000 > AUDIT_MAX_DAYS',
  },
  { name: 'jedan dan (početak = kraj) se odbija', file: f('audit-filter.ts'), from: 'fromDate > toDate ?', to: 'fromDate >= toDate ?' },
  { name: 'kursor bez završnog $ (propušta višak)', file: f('audit-filter.ts'), from: '[0-9a-fA-F]{12})$/;', to: '[0-9a-fA-F]{12})/;' },
  { name: 'kursor dozvoljava do 9 decimala', file: f('audit-filter.ts'), from: '(?:\\.\\d{1,6})?', to: '(?:\\.\\d{1,9})?' },
  { name: 'keyset filter bez navodnika oko vremena', file: f('audit-filter.ts'), from: 'const t = `"${cursor.createdAt}"`;', to: 'const t = cursor.createdAt;' },
  { name: 'keyset filter bez razrešavanja izjednačenih vremena (samo created_at)', file: f('audit-filter.ts'), from: 'return `created_at.lt.${t},and(created_at.eq.${t},id.lt.${cursor.id})`;', to: 'return `created_at.lt.${t}`;' },
  { name: 'keyset filter bez provere oblika kursora', file: f('audit-filter.ts'), from: "if (parseCursor(encodeCursor(cursor)) === null) throw new RangeError('Neispravan kursor.');", to: '' },
  { name: 'prazno polje iz forme se ne tumači kao "nije zadato"', file: f('audit-filter.ts'), from: "(v) => (v === '' || v === null ? undefined : v)", to: '(v) => v' },
  { name: 'advokat: bilo koji tekst umesto UUID-a', file: f('audit-filter.ts'), from: 'user: optional(z.guid({ error: messages.user })),', to: 'user: optional(z.string()),' },
  { name: 'veze ne nose period', file: f('audit-filter.ts'), from: "params.set('from', filter.fromDate);", to: '' },
  { name: 'searchParamsRecord sa običnim objektom (prototip)', file: f('audit-filter.ts'), from: 'Object.create(null)', to: '{}' },

  // --- audit-export.ts
  { name: 'petlja staje na "kratkoj strani" (max_rows)', file: f('audit-export.ts'), from: 'if (page.length === 0) return;', to: 'if (page.length < Math.min(pageSize, total - sent)) return;' },
  { name: 'strana veća od tražene se ne seče na ukupan broj', file: f('audit-export.ts'), from: 'const rows = page.slice(0, total - sent);', to: 'const rows = page;' },
  { name: 'kursor je prvi red strane umesto poslednjeg', file: f('audit-export.ts'), from: 'const last = rows[rows.length - 1];', to: 'const last = rows[0];' },
  { name: 'kursor bez id-a (izjednačena vremena se preskaču)', file: f('audit-export.ts'), from: 'cursor = { createdAt: last.created_at, id: last.id };', to: "cursor = { createdAt: last.created_at, id: '00000000-0000-0000-0000-000000000000' };" },
  { name: 'tuđi sajt: prolazi sve osim cross-site', file: f('audit-export.ts'), from: "return secFetchSite !== null && secFetchSite !== 'same-origin' && secFetchSite !== 'none';", to: "return secFetchSite === 'cross-site';" },
  { name: 'tuđi sajt: nikad se ne odbija', file: f('audit-export.ts'), from: "return secFetchSite !== null && secFetchSite !== 'same-origin' && secFetchSite !== 'none';", to: 'return false;' },
  { name: 'najveći broj redova 500.000', file: f('audit-export.ts'), from: 'export const EXPORT_MAX_ROWS = 50_000;', to: 'export const EXPORT_MAX_ROWS = 500_000;' },
  { name: 'strana izvoza veća od max_rows (1000)', file: f('audit-export.ts'), from: 'export const EXPORT_PAGE_SIZE = 500;', to: 'export const EXPORT_PAGE_SIZE = 5000;' },
  { name: 'kolone Korisnik i ID korisnika zamenjene', file: f('audit-export.ts'), from: '    row.actor_email,\n    row.user_id,', to: '    row.user_id,\n    row.actor_email,' },
  { name: 'metapodaci se ne izvoze', file: f('audit-export.ts'), from: "isRecord(row.metadata) && Object.keys(row.metadata).length > 0 ? JSON.stringify(row.metadata) : '',", to: "''," },
  { name: 'ime fajla sa obrnutim datumima', file: f('audit-export.ts'), from: '`aktivnost_${filter.fromDate}_${filter.toDate}.csv`', to: '`aktivnost_${filter.toDate}_${filter.fromDate}.csv`' },

  // --- csv.ts
  { name: 'csvLine završava sa LF umesto CRLF', file: f('csv.ts'), from: 'return `${cells.map(csvCell).join(CSV_DELIMITER)}\\r\\n`;', to: 'return `${cells.map(csvCell).join(CSV_DELIMITER)}\\n`;' },
  // U fajlu je doslovni BOM znak (kao u originalnom `const BOM`), pa se izraz gradi preko kôda znaka
  { name: 'CSV_BOM prazan (Excel kvari slova)', file: f('csv.ts'), from: `export const CSV_BOM = '${String.fromCharCode(0xfeff)}';`, to: "export const CSV_BOM = '';" },

  // --- office-settings.ts
  { name: 'važeći limit je veći od dva umesto manjeg', file: f('office-settings.ts'), from: 'const effective = cap === null ? value : Math.min(value, cap);', to: 'const effective = cap === null ? value : Math.max(value, cap);' },
  { name: 'napomena i kad je granica jednaka vrednosti', file: f('office-settings.ts'), from: 'cap !== null && cap < value ?', to: 'cap !== null && cap <= value ?' },
  { name: 'napomena uvek kad granica postoji', file: f('office-settings.ts'), from: 'cap !== null && cap < value ?', to: 'cap !== null ?' },
  { name: 'RPC: dnevni limit poruka dobija vrednost dokumenata', file: f('office-settings.ts'), from: 'p_daily_message_limit: limits.dailyMessages,', to: 'p_daily_message_limit: limits.dailyDocuments,' },
  { name: '"nema promena" i kad se promeni samo jedno polje', file: f('office-settings.ts'), from: 'return SETTINGS_FIELDS.every(({ key }) => current[key] === next[key]);', to: 'return SETTINGS_FIELDS.some(({ key }) => current[key] === next[key]);' },
  { name: '23514 se prikazuje kao poruka za poslednjeg admina', file: f('office-settings.ts'), from: "return 'Vrednost je van dozvoljenog opsega.';", to: "return 'Kancelarija mora imati bar jednog aktivnog admina.';" },
  { name: 'kolona mesečnog budžeta fali u upitu', file: f('office-settings.ts'), from: ', monthly_token_budget\';', to: '\';' },

  // --- activity.ts
  { name: 'datum u opisu izvoza obrnut (GGGG.MM.DD.)', file: f('activity.ts'), from: 'return m ? `${m[3]}.${m[2]}.${m[1]}.` : null;', to: 'return m ? `${m[1]}.${m[2]}.${m[3]}.` : null;' },
  { name: 'skraćen izvoz se prikazuje i kad nije', file: f('activity.ts'), from: 'if (meta.truncated === true)', to: 'if (meta.truncated !== undefined)' },
  { name: 'ATTENTION_ACTIONS bez limit_reached', file: f('activity.ts'), from: "  'limit_reached',\n  'document_upload_blocked',", to: "  'document_upload_blocked'," },
];

const { results, intact } = await runMutations(mutations, () => runUnitTests(root), { label: 'Mutacije lib/ (2.5.7 i 2.5.8)' });
const bad = results.filter((r) => (r.status !== 'UHVAĆENA' && !r.equivalent) || false);
process.exit(intact && bad.length === 0 ? 0 : 1);
