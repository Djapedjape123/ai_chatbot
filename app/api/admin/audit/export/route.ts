import type { NextRequest } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/require-admin';
import { MFA_REQUIRED_MESSAGE } from '@/lib/mfa-gate';
import { writeAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { parseAuditFilter, searchParamsRecord } from '@/lib/audit-filter';
import { auditCountQuery, auditPageQuery } from '@/lib/audit-query';
import {
  AUDIT_CSV_HEADER,
  EXPORT_MAX_ROWS,
  EXPORT_PAGE_SIZE,
  auditCsvRow,
  auditExportRows,
  exportFileName,
  isCrossSiteRequest,
  type FetchAuditPage,
} from '@/lib/audit-export';
import { CSV_BOM, csvLine } from '@/lib/csv';
import type { ActivityRow } from '@/lib/activity';

// CSV izvoz dnevnika aktivnosti (2.5.7). Samo admin sa aal2. Redovi se čitaju strana po strana i šalju kao strim:
// odgovor Vercel funkcije koji nije strim ne sme preko ~4,5 MB, a 50.000 redova to premašuje.
// Dugo trajanje je očekivano (stotinak upita po 500 redova), pa je gornja granica izričita.
export const maxDuration = 60;

// Redova po delu strima: dovoljno malo da prvi podaci stignu odmah, dovoljno veliko da nema 50.000 malih delova
const CHUNK_ROWS = 250;

const encoder = new TextEncoder();

export async function GET(request: NextRequest) {
  // Izvoz ima posledicu (audit zapis), a kolačić sesije putuje i uz navigaciju sa tuđeg sajta
  if (isCrossSiteRequest(request.headers.get('sec-fetch-site'))) {
    return apiError('Zahtev nije dozvoljen.', 403, 'forbidden');
  }

  // Ruta ne otkriva da postoji: za nalog koji nije admin odgovor je isti kao za nepostojeću adresu
  const admin = await requireAdmin();
  if (!admin) return apiError('Nije pronađeno.', 404, 'not_found');
  if (admin.mfa !== 'ok') return apiError(MFA_REQUIRED_MESSAGE, 403, 'mfa_required');

  const parsed = parseAuditFilter(searchParamsRecord(request.nextUrl.searchParams), new Date());
  if (!parsed.ok) return apiError(parsed.error, 400, 'invalid_filter');
  const filter = { ...parsed.filter, cursor: null }; // izvoz uvek kreće od najnovijeg zapisa

  // Gornja granica se zamrzava na početak izvoza: novi zapisi (uključujući sam audit_exported) ne ulaze u ovaj fajl,
  // pa se broj redova upisan u audit ne razilazi sa sadržajem fajla
  const startedAt = new Date().toISOString();
  const until = filter.toUtcExclusive < startedAt ? filter.toUtcExclusive : startedAt;

  const { supabase, user } = admin;
  const { count, error: countError } = await auditCountQuery(supabase, filter, { until });
  if (countError || count === null) {
    console.error('Audit Export Count Error:', countError?.code);
    return apiError('Izvoz nije uspeo. Pokušajte ponovo.', 500, 'export_failed');
  }
  const total = Math.min(count, EXPORT_MAX_ROWS);

  // Zapis PRE slanja i zatvoreno pravilo: bez traga u dnevniku nema izvoza
  const logged = await writeAudit({ id: user.id, email: user.email }, 'audit_exported', {
    metadata: {
      rows: total,
      truncated: count > EXPORT_MAX_ROWS,
      from: filter.fromDate,
      to: filter.toDate,
      user: filter.userId,
      action: filter.action,
    },
    ip: getClientIp(request.headers),
  });
  if (!logged) {
    return apiError('Izvoz nije pokrenut jer zapis u dnevnik aktivnosti nije uspeo. Pokušajte ponovo.', 500, 'audit_failed');
  }

  const fetchPage: FetchAuditPage<ActivityRow> = async (cursor, limit) => {
    const { data, error } = await auditPageQuery(supabase, { ...filter, cursor }, limit, { until });
    if (error) throw new Error(`Audit Export Page Error: ${error.code}`);
    return (data ?? []) as ActivityRow[];
  };
  const rows = auditExportRows(fetchPage, total, EXPORT_PAGE_SIZE);

  let headerSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(CSV_BOM + csvLine(AUDIT_CSV_HEADER)));
          return;
        }
        let chunk = '';
        for (let i = 0; i < CHUNK_ROWS; i++) {
          const next = await rows.next();
          if (next.done) break;
          chunk += csvLine(auditCsvRow(next.value));
        }
        if (chunk) controller.enqueue(encoder.encode(chunk));
        else controller.close();
      } catch (error) {
        // Posle slanja zaglavlja status se ne može promeniti: prekid veze je jedini način da preuzimanje ne
        // izgleda uspešno. Skraćen fajl koji izgleda potpun bio bi gori od prekinutog preuzimanja.
        console.error('Audit Export Stream Error:', error instanceof Error ? error.message : error);
        controller.error(error);
      }
    },
    async cancel() {
      await rows.return(undefined); // klijent je odustao: ne čitaj dalje
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFileName(filter)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
