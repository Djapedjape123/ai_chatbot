import { describeActivity, formatBelgrade, type ActivityRow } from './activity.ts';
import type { AuditCursor, AuditFilter } from './audit-filter.ts';
import type { CsvValue } from './csv.ts';

// CSV izvoz dnevnika aktivnosti (2.5.7). Čist kod bez server-only importa (npm test).
// Izvoz ide strana po strana (keyset po created_at, id) i šalje se kao strim: odgovor Vercel funkcije koji nije
// strim ne sme preko ~4,5 MB, a 50.000 redova to premašuje. Supabase API vraća najviše max_rows (obično 1000)
// redova po upitu, pa je strana manja od toga, a kraj se određuje brojačem i praznom stranom, nikad "kratkom stranom".

export const EXPORT_MAX_ROWS = 50_000;
export const EXPORT_PAGE_SIZE = 500;

export const AUDIT_CSV_HEADER = [
  'Vreme (Beograd)',
  'Vreme (UTC)',
  'Korisnik',
  'ID korisnika',
  'Akcija',
  'Šifra akcije',
  'Detalji',
  'Tip resursa',
  'ID resursa',
  'IP adresa',
  'Metapodaci',
];

// Nazivi dokumenata se ne čuvaju u audit logu, pa detalji koriste skraćene ID-eve; puni ID-evi su u kolonama
// "ID resursa" i "Metapodaci" (npr. document_ids za pitanje: ko je pročitao koji dokument).
const NO_TITLES: ReadonlyMap<string, string> = new Map();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function auditCsvRow(row: ActivityRow): CsvValue[] {
  const { label, details } = describeActivity(row, NO_TITLES);
  const instant = new Date(row.created_at);
  return [
    formatBelgrade(row.created_at),
    Number.isNaN(instant.getTime()) ? '' : instant.toISOString(),
    row.actor_email,
    row.user_id,
    label,
    row.action,
    details.join('; '),
    row.resource_type,
    row.resource_id,
    row.ip,
    isRecord(row.metadata) && Object.keys(row.metadata).length > 0 ? JSON.stringify(row.metadata) : '',
  ];
}

// Ime fajla je samo ASCII i potiče od već proverenih datuma (nema korisničkog teksta u zaglavlju odgovora)
export function exportFileName(filter: Pick<AuditFilter, 'fromDate' | 'toDate'>): string {
  return `aktivnost_${filter.fromDate}_${filter.toDate}.csv`;
}

export type FetchAuditPage<T> = (cursor: AuditCursor | null, limit: number) => Promise<T[]>;

// Redovi redom od najnovijeg, do `total` komada. Kursor je poslednji isporučeni red. Greška čitanja se prosleđuje:
// izvoz koji se tiho skrati izgledao bi kao potpun, a to je gore od prekinutog preuzimanja.
export async function* auditExportRows<T extends { id: string; created_at: string }>(
  fetchPage: FetchAuditPage<T>,
  total: number,
  pageSize: number,
): AsyncGenerator<T> {
  let sent = 0;
  let cursor: AuditCursor | null = null;

  while (sent < total) {
    const page = await fetchPage(cursor, Math.min(pageSize, total - sent));
    if (page.length === 0) return;

    const rows = page.slice(0, total - sent);
    for (const row of rows) yield row;

    sent += rows.length;
    const last = rows[rows.length - 1];
    cursor = { createdAt: last.created_at, id: last.id };
  }
}

// Izvoz je GET sa posledicom (audit zapis), a kolačić sesije putuje i uz navigaciju sa tuđeg sajta.
// Pregledač šalje Sec-Fetch-Site: dozvoljeno je samo naše poreklo ili ručno otvaranje adrese ("none").
// Zahtev bez zaglavlja (stariji pregledači, alati) prolazi: tu ostaje zaštita prijave i aal2.
export function isCrossSiteRequest(secFetchSite: string | null): boolean {
  return secFetchSite !== null && secFetchSite !== 'same-origin' && secFetchSite !== 'none';
}
