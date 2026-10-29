import type { AuditAction } from './audit.ts';
import { PATTERN_LABELS } from './prompt-safety.ts';

// Prikaz audit loga na stranici /activity. Čist kod bez server-only importa, da bi se mogao testirati (npm test).
// Audit ne čuva sadržaj ni nazive fajlova, pa se naslovi prikazuju samo za dokumente koji još postoje.

export const PAGE_SIZE = 50;
// Retencija je 90 dana, pa dublje strane nemaju smisla; granica čuva i bazu od proizvoljnog OFFSET-a
export const MAX_PAGE = 200;

export const ACTION_LABELS: Record<AuditAction, string> = {
  document_uploaded: 'Dodat dokument',
  document_upload_blocked: 'Blokirano otpremanje',
  document_deleted: 'Obrisan dokument',
  chat_created: 'Započet razgovor',
  chat_deleted: 'Obrisan razgovor',
  question_asked: 'Postavljeno pitanje',
  limit_reached: 'Dostignut limit',
  suspicious_content_flagged: 'Sumnjiv sadržaj u dokumentu',
  user_invited: 'Pozvan advokat',
  user_disabled: 'Blokiran nalog',
  user_enabled: 'Odblokiran nalog',
  role_changed: 'Promenjena uloga',
  settings_changed: 'Promenjena podešavanja',
  admin_viewed_user: 'Pregledan nalog advokata',
  audit_exported: 'Izvezen dnevnik aktivnosti',
  mfa_enrolled: 'Uključena dvostepena prijava',
  mfa_removed: 'Uklonjena dvostepena prijava',
};

const ROLE_LABELS: Record<string, string> = { admin: 'admin', lawyer: 'advokat' };

// Redosled je redosled prikaza; ključevi su kolone office_settings kako ih upisuje admin_update_settings
const SETTING_LABELS: [key: string, label: string][] = [
  ['daily_message_limit', 'Dnevni limit poruka'],
  ['daily_document_limit', 'Dnevni limit dokumenata'],
  ['daily_token_budget', 'Dnevni budžet obrade'],
  ['monthly_token_budget', 'Mesečni budžet obrade'],
];

export const ACTIVITY_ACTIONS = Object.keys(ACTION_LABELS) as AuditAction[];

// Zapisi koji traže pažnju admina (limit, blokirano otpremanje, sumnjiv fajl ili uklonjena dvostepena prijava);
// stranice ih boje drugačije
export const ATTENTION_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  'limit_reached',
  'document_upload_blocked',
  'suspicious_content_flagged',
  'mfa_removed',
]);

export type ActivityRow = {
  id: string;
  user_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: unknown;
  ip: string | null;
  created_at: string;
};

export type ActivityQuery = { page: number; action: AuditAction | null };

// Parametri iz URL-a su ulaz korisnika: sve što nije očekivanog oblika pada na podrazumevanu vrednost
export function parseActivityQuery(params: Record<string, string | string[] | undefined>): ActivityQuery {
  const rawPage = params.page;
  const page = typeof rawPage === 'string' && /^[1-9]\d*$/.test(rawPage) ? Math.min(Number(rawPage), MAX_PAGE) : 1;
  const rawAction = params.action;
  const action = typeof rawAction === 'string' && Object.hasOwn(ACTION_LABELS, rawAction) ? (rawAction as AuditAction) : null;
  return { page, action };
}

const belgradeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Belgrade',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Server radi u UTC, a kancelarija je u Beogradu: vreme se uvek prikazuje po beogradskom
export function formatBelgrade(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const p = Object.fromEntries(belgradeFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return `${p.day}.${p.month}.${p.year}. ${p.hour}:${p.minute}`;
}

export type ActivityDescription = { label: string; details: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const shortId = (id: string) => `ID ${id.slice(0, 8)}`;
// 'GGGG-MM-DD' (beogradski datum iz metadata) -> 'DD.MM.GGGG.'; sve drugo je null
const isoDay = (v: unknown): string | null => {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}.` : null;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const [value, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / (1024 * 1024), 'MB'];
  return `${value.toFixed(1).replace('.', ',')} ${unit}`;
}

const BLOCK_REASONS: Record<string, string> = {
  unreadable_pdf: 'PDF je oštećen ili nije ispravan',
  no_text: 'PDF nema tekst (verovatno je skeniran)',
  too_many_chunks: 'Dokument je prevelik za obradu',
};

function limitText(kind: unknown, reason: unknown): string | null {
  if (reason === 'daily_count') return kind === 'ingest' ? 'Dnevni limit dokumenata' : kind === 'chat' ? 'Dnevni limit poruka' : null;
  if (reason === 'daily_tokens') return 'Dnevni budžet obrade';
  if (reason === 'monthly_tokens') return 'Mesečni budžet obrade';
  return null;
}

// Opis jednog zapisa za prikaz. metadata je podatak iz baze (nepouzdan oblik), pa se svako polje proverava.
export function describeActivity(row: ActivityRow, titles: ReadonlyMap<string, string>): ActivityDescription {
  if (!Object.hasOwn(ACTION_LABELS, row.action)) return { label: row.action, details: [] };

  const action = row.action as AuditAction;
  const meta = isRecord(row.metadata) ? row.metadata : {};
  const details: string[] = [];
  const documentLine = () => {
    if (row.resource_id) details.push(`Dokument: ${titles.get(row.resource_id) ?? shortId(row.resource_id)}`);
  };
  const chatLine = () => {
    if (row.resource_id) details.push(`Razgovor: ${shortId(row.resource_id)}`);
  };
  const sizeLine = () => {
    const size = count(meta.size_bytes);
    if (size !== null) details.push(`Veličina: ${formatSize(size)}`);
  };
  const userLine = () => {
    if (row.resource_id) details.push(`Nalog: ${shortId(row.resource_id)}`);
  };
  const roleName = (v: unknown) => (typeof v === 'string' && Object.hasOwn(ROLE_LABELS, v) ? ROLE_LABELS[v] : null);

  switch (action) {
    case 'document_uploaded': {
      documentLine();
      const chunks = count(meta.chunks);
      if (chunks !== null) details.push(`Pasusa: ${chunks}`);
      sizeLine();
      if (meta.suspicious === true) details.push('Sadržaj je bio označen kao sumnjiv');
      break;
    }
    case 'document_upload_blocked': {
      const reason = typeof meta.reason === 'string' ? BLOCK_REASONS[meta.reason] : undefined;
      if (reason) details.push(reason);
      sizeLine();
      break;
    }
    case 'document_deleted':
      documentLine();
      break;
    case 'chat_created':
    case 'chat_deleted':
      chatLine();
      break;
    case 'question_asked': {
      chatLine();
      if (Array.isArray(meta.document_ids)) {
        const sources = meta.document_ids.filter((id): id is string => typeof id === 'string');
        const chunks = count(meta.sources) ?? 0;
        if (sources.length > 0) details.push(`Izvori: ${sources.map((id) => titles.get(id) ?? shortId(id)).join(', ')}`);
        // Zapisi pre migracije match_chunks_document_id imaju pasuse, ali ne i ID-eve dokumenata
        else if (chunks > 0) details.push(`Broj pasusa iz izvora: ${chunks} (dokumenti nisu zabeleženi)`);
        else details.push('Bez izvora iz dokumenata');
      }
      const tokens = [meta.input_tokens, meta.output_tokens, meta.embed_tokens].map(count).filter((n): n is number => n !== null);
      if (tokens.length > 0) details.push(`Potrošeno tokena: ${tokens.reduce((a, b) => a + b, 0)}`);
      break;
    }
    case 'limit_reached': {
      const text = limitText(meta.kind, meta.reason);
      if (text) details.push(text);
      break;
    }
    case 'suspicious_content_flagged': {
      documentLine();
      const found = Array.isArray(meta.patterns)
        ? meta.patterns.filter((p): p is string => typeof p === 'string' && Object.hasOwn(PATTERN_LABELS, p))
        : [];
      if (found.length > 0) details.push(`Pronađeno: ${found.map((p) => PATTERN_LABELS[p as keyof typeof PATTERN_LABELS]).join('; ')}`);
      if (meta.acknowledged === true) details.push('Korisnik je potvrdio otpremanje');
      else if (meta.acknowledged === false) details.push('Otpremanje nije potvrđeno');
      break;
    }
    case 'user_invited': {
      userLine();
      if (typeof meta.email === 'string' && meta.email.length > 0) details.push(`Email: ${meta.email.slice(0, 254)}`);
      break;
    }
    case 'user_disabled':
    case 'user_enabled':
    case 'admin_viewed_user':
      userLine();
      break;
    case 'role_changed': {
      userLine();
      const from = roleName(meta.from);
      const to = roleName(meta.to);
      if (from && to) details.push(`Uloga: ${from} → ${to}`);
      break;
    }
    case 'settings_changed': {
      if (isRecord(meta.old) && isRecord(meta.new)) {
        for (const [key, label] of SETTING_LABELS) {
          const before = count(meta.old[key]);
          const after = count(meta.new[key]);
          if (before !== null && after !== null && before !== after) details.push(`${label}: ${before} → ${after}`);
        }
      }
      break;
    }
    case 'audit_exported': {
      const from = isoDay(meta.from);
      const to = isoDay(meta.to);
      if (from && to) details.push(`Period: ${from} – ${to}`);
      if (typeof meta.action === 'string' && Object.hasOwn(ACTION_LABELS, meta.action)) {
        details.push(`Vrsta: ${ACTION_LABELS[meta.action as AuditAction]}`);
      }
      if (typeof meta.user === 'string' && meta.user.length > 0) details.push(`Advokat: ${shortId(meta.user)}`);
      const rows = count(meta.rows);
      if (rows !== null) details.push(`Izvezeno redova: ${rows}`);
      if (meta.truncated === true) details.push('Izvoz je skraćen: premašen je najveći dozvoljeni broj redova');
      break;
    }
    case 'mfa_enrolled':
      break;
    case 'mfa_removed':
      // Okidač u bazi ne zna ko je kliknuo (Auth server briše faktor bez JWT-a korisnika): zapis to ne sme da prećuti
      details.push('Ko je uklonio faktor nije zabeleženo (korisnik sam ili vlasnik projekta)');
      break;
  }

  return { label: ACTION_LABELS[action], details };
}
