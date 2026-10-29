// Namerne greške 2.5.11 u aplikaciji (akcija mfa_removed u lib/activity.ts). Hvata ih `npm test`, brzo (~1 s po mutaciji).
// Pokretanje iz korena repozitorijuma: node tools/verify/mutations-ts-2-5-11.mjs
// Ne pokretati dok se menjaju isti fajlovi, ni zajedno sa build-om ili `npm test`: runner prepisuje izvorne fajlove.
// (Mutacije same migracije su u mutations-sql-2-5-11.mjs i rade u memoriji, bez prepisivanja fajlova.)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutations, runUnitTests } from './lib/mutate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const activity = path.join(root, 'lib', 'activity.ts');

const mutations = [
  { name: 'opis akcije je pogrešan ("Uključena" umesto "Uklonjena")', file: activity, from: "mfa_removed: 'Uklonjena dvostepena prijava',", to: "mfa_removed: 'Uključena dvostepena prijava'," },
  { name: 'opis akcije izostavljen (prikaz pada na sirov naziv akcije)', file: activity, from: "  mfa_removed: 'Uklonjena dvostepena prijava',\n};", to: '};' },
  { name: 'uklonjena MFA ne traži pažnju admina', file: activity, from: "  'mfa_removed',\n]);", to: ']);' },
  { name: 'napomena da izvršilac nije zabeležen je izostavljena', file: activity, from: "details.push('Ko je uklonio faktor nije zabeleženo (korisnik sam ili vlasnik projekta)');", to: '' },
  { name: 'napomena tvrdi da je korisnik sam uklonio faktor', file: activity, from: 'Ko je uklonio faktor nije zabeleženo (korisnik sam ili vlasnik projekta)', to: 'Faktor je uklonio sam korisnik' },
];

const { results, intact } = await runMutations(mutations, () => runUnitTests(root), { label: 'mutacije 2.5.11 (aplikacija)' });
const survived = results.filter((r) => r.status === 'PREŽIVELA' && !r.equivalent).length;
const unapplied = results.filter((r) => r.status === 'NEPRIMENJENA').length;
process.exit(survived || unapplied || !intact ? 1 : 0);
