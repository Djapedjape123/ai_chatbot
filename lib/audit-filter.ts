import { z } from 'zod';
import { ACTIVITY_ACTIONS } from './activity.ts';
import type { AuditAction } from './audit.ts';
import { addDays, belgradeDateOf, belgradeMidnightUtc, daysInclusive, isRealDate } from './belgrade-time.ts';

// Filteri dnevnika aktivnosti u admin panelu (2.5.7): advokat, vrsta aktivnosti, period i kursor za sledeću stranu.
// Isti filteri važe za stranicu /admin/activity i za CSV izvoz. Čist kod bez server-only importa (npm test).
// Period se zadaje beogradskim datumima (GGGG-MM-DD), a ovde se pretvara u UTC granice za bazu.

export const AUDIT_MAX_DAYS = 90; // jednako retenciji audit loga (pg_cron briše starije)
export const AUDIT_DEFAULT_DAYS = 7;

export type AuditCursor = { createdAt: string; id: string };

export type AuditFilter = {
  userId: string | null;
  action: AuditAction | null;
  // Beogradski datumi, oba uključena
  fromDate: string;
  toDate: string;
  // Granice za upit: from je uključen, to je isključen (ponoć posle toDate)
  fromUtc: string;
  toUtcExclusive: string;
  cursor: AuditCursor | null;
};

export type AuditFilterResult = { ok: true; filter: AuditFilter } | { ok: false; error: string };

// Kursor stiže iz URL-a i ulazi u PostgREST filter (keysetFilter), pa je oblik strogo ograničen: bez zareza,
// zagrada, navodnika i razmaka. Vreme je onako kako ga PostgREST vraća (do 6 decimala, mikrosekunde Postgresa).
const CURSOR_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function parseCursor(raw: string): AuditCursor | null {
  const m = CURSOR_RE.exec(raw);
  if (!m || Number.isNaN(Date.parse(m[1]))) return null;
  return { createdAt: m[1], id: m[2] };
}

export function encodeCursor(cursor: AuditCursor): string {
  return `${cursor.createdAt}_${cursor.id}`;
}

// Uslov "strogo stariji od kursora" za redosled (created_at opadajuće, id opadajuće). Sam created_at nije dovoljan:
// zapisi u istoj transakciji dele vreme, pa bi se redovi sa istim vremenom preskakali. Vreme ide pod dvostrukim
// navodnicima jer je ":" rezervisan znak u PostgREST filterima (dokumentacija: reserved characters).
export function keysetFilter(cursor: AuditCursor): string {
  // Zatvoreno pravilo: filter se gradi samo od vrednosti koja prolazi istu proveru kao kursor iz URL-a
  if (parseCursor(encodeCursor(cursor)) === null) throw new RangeError('Neispravan kursor.');
  const t = `"${cursor.createdAt}"`;
  return `created_at.lt.${t},and(created_at.eq.${t},id.lt.${cursor.id})`;
}

const messages = {
  user: 'Izabrani advokat nije ispravan.',
  action: 'Izabrana vrsta aktivnosti nije ispravna.',
  date: 'Unesite ispravan datum (GGGG-MM-DD).',
  cursor: 'Strana nije ispravna. Vratite se na početak liste.',
  order: 'Početak perioda ne može biti posle kraja.',
  tooLong: `Period može biti najviše ${AUDIT_MAX_DAYS} dana.`,
  request: 'Neispravan zahtev.',
};

// Prazno polje iz forme znači "nije zadato"
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());

const dateField = z.string({ error: messages.date }).refine(isRealDate, messages.date);

// `now` je parametar jer podrazumevani period zavisi od današnjeg (beogradskog) dana
export function createAuditFilterSchema(now: Date) {
  return z
    .object(
      {
        user: optional(z.guid({ error: messages.user })),
        action: optional(z.enum(ACTIVITY_ACTIONS as [AuditAction, ...AuditAction[]], { error: messages.action })),
        from: optional(dateField),
        to: optional(dateField),
        cursor: optional(
          z
            .string({ error: messages.cursor })
            .refine((v) => parseCursor(v) !== null, messages.cursor)
            .transform((v) => parseCursor(v) as AuditCursor),
        ),
      },
      { error: messages.request },
    )
    .transform((v, ctx): AuditFilter => {
      const toDate = v.to ?? belgradeDateOf(now);
      const fromDate = v.from ?? addDays(toDate, -(AUDIT_DEFAULT_DAYS - 1));

      const problem = fromDate > toDate ? messages.order : daysInclusive(fromDate, toDate) > AUDIT_MAX_DAYS ? messages.tooLong : null;
      if (problem) {
        ctx.issues.push({ code: 'custom', message: problem, input: v });
        return z.NEVER;
      }

      return {
        userId: v.user ?? null,
        action: v.action ?? null,
        fromDate,
        toDate,
        fromUtc: belgradeMidnightUtc(fromDate).toISOString(),
        toUtcExclusive: belgradeMidnightUtc(addDays(toDate, 1)).toISOString(),
        cursor: v.cursor ?? null,
      };
    });
}

// searchParams stranice (ili Object.fromEntries URL parametara rute) -> filter ili poruka na srpskom
export function parseAuditFilter(input: Record<string, string | string[] | undefined>, now: Date): AuditFilterResult {
  const parsed = createAuditFilterSchema(now).safeParse(input);
  if (parsed.success) return { ok: true, filter: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? messages.request };
}

// Podrazumevani filter (poslednjih 7 dana). Prazan unos je uvek ispravan, pa nema grane za grešku.
export function defaultAuditFilter(now: Date): AuditFilter {
  return createAuditFilterSchema(now).parse({});
}

// Parametri za linkove (sledeća strana, izvoz): period je uvek izričit, da podrazumevanih "7 dana" ne pomeri
// ponoć dok je stranica otvorena. Kursor se ne prenosi.
export function auditFilterParams(filter: AuditFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.userId) params.set('user', filter.userId);
  if (filter.action) params.set('action', filter.action);
  params.set('from', filter.fromDate);
  params.set('to', filter.toDate);
  return params;
}

// URLSearchParams -> običan zapis za parseAuditFilter (kao searchParams stranice): ponovljen parametar postaje niz,
// koji šema odbija. Prototip je null, pa ključ "__proto__" iz URL-a ne može da dotakne Object.prototype.
export function searchParamsRecord(params: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = Object.create(null);
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    record[key] = all.length > 1 ? all : all[0];
  }
  return record;
}
