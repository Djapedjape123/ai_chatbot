// Lažni Supabase (Auth + REST + RPC) za probu aplikacije na pravom `next start`. Samo Node, bez zavisnosti.
//
// Šta sme da se tvrdi na osnovu njega: ŠTA aplikacija šalje (adrese, parametri, zaglavlja, ko je pozivalac: JWT admina
// ili servisni ključ) i kako reaguje na odgovore. Šta NE sme: da pravi Supabase isto odgovara. Zato je ovde ponašanje
// PostgREST-a gde god sam ga proverio strogo (npr. vrednost u or=(...) sa rezervisanim znakom ":" mora biti pod
// navodnicima), a ostalo je minimum potreban za proveru. Sve odstupanje od pravog servera treba tražiti u README.md.

import http from 'node:http';
import crypto from 'node:crypto';

export const ANON_KEY = 'fake-anon-key';
export const SERVICE_KEY = 'fake-service-key';

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

// JWT bez pravog potpisa: aplikacija čita samo payload (sub, aal), a o važenju odlučuje getUser() (ovaj server)
export function makeJwt({ sub, aal = 'aal1' }) {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, aal, role: 'authenticated', exp: 4_102_444_800 })}.sig`;
}

function decodeJwt(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// created_at kao mikrosekunde (BigInt): Postgres ima mikrosekunde, a JS Date samo milisekunde. Poređenje preko
// Date-a bi sakrilo grešku u kursoru za redove koji dele milisekundu.
export function toMicros(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(String(value));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const offset = m[8] === 'Z' ? 0 : (m[8][0] === '-' ? -1 : 1) * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(4, 6))) * 60_000;
  return BigInt(ms - offset) * 1000n + BigInt((m[7] ?? '').padEnd(6, '0'));
}

// Oblik u kom PostgREST vraća timestamptz: mikrosekunde bez završnih nula, pomak +00:00
export function formatTs(micros) {
  const ms = Number(micros / 1000n);
  const frac = String(micros % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  const base = new Date(ms).toISOString().slice(0, 19);
  return `${base}${frac ? `.${frac}` : ''}+00:00`;
}

class PostgrestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// or=(a.op.v,and(b.op.v,c.op.v)) -> drvo uslova. Vrednost sa rezervisanim znakom (: , . * ( )) mora biti pod
// navodnicima, kao u dokumentaciji PostgREST-a; nenavedena takva vrednost je greška razbora (PGRST100).
function parseLogic(text) {
  let i = 0;
  const fail = (why) => {
    throw new PostgrestError(400, 'PGRST100', `"failed to parse logic tree (${text})" ${why}`);
  };
  function parseValue() {
    if (text[i] === '"') {
      i++;
      let out = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        out += text[i++];
      }
      if (text[i] !== '"') fail('unterminated quote');
      i++;
      return out;
    }
    const start = i;
    while (i < text.length && text[i] !== ',' && text[i] !== ')') i++;
    const raw = text.slice(start, i);
    if (/[:*(]/.test(raw)) fail(`unquoted reserved character in value ${raw}`);
    return raw;
  }
  function parseList() {
    if (text[i] !== '(') fail('expected (');
    i++;
    const items = [];
    for (;;) {
      items.push(parseItem());
      if (text[i] === ',') i++;
      else break;
    }
    if (text[i] !== ')') fail('expected )');
    i++;
    return items;
  }
  function parseItem() {
    for (const op of ['and', 'or']) {
      if (text.startsWith(`${op}(`, i)) {
        i += op.length;
        return { op, items: parseList() };
      }
    }
    const m = /^([a-z_]+)\.(eq|lt|lte|gt|gte|neq)\./.exec(text.slice(i));
    if (!m) fail('expected column.operator.value');
    i += m[0].length;
    return { column: m[1], operator: m[2], value: parseValue() };
  }
  const items = parseList();
  if (i !== text.length) fail('trailing characters');
  return { op: 'or', items };
}

const COMPARE = { eq: (c) => c === 0, neq: (c) => c !== 0, lt: (c) => c < 0, lte: (c) => c <= 0, gt: (c) => c > 0, gte: (c) => c >= 0 };

function compareValues(column, rowValue, text) {
  if (column === 'created_at') {
    const a = toMicros(rowValue);
    const b = toMicros(text);
    if (b === null) throw new PostgrestError(400, '22007', `invalid input syntax for type timestamp with time zone: "${text}"`);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (column === 'id' || column === 'user_id') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
      throw new PostgrestError(400, '22P02', `invalid input syntax for type uuid: "${text}"`);
    }
    const a = String(rowValue ?? '').toLowerCase();
    const b = text.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = String(rowValue ?? '');
  return a < text ? -1 : a > text ? 1 : 0;
}

function evalNode(node, row) {
  if (node.op === 'and') return node.items.every((n) => evalNode(n, row));
  if (node.op === 'or') return node.items.some((n) => evalNode(n, row));
  return COMPARE[node.operator](compareValues(node.column, row[node.column], node.value));
}

const AUDIT_COLUMNS = ['id', 'user_id', 'actor_email', 'action', 'resource_type', 'resource_id', 'metadata', 'ip', 'created_at'];

function pickColumns(row, select, allowed) {
  const wanted = select && select !== '*' ? select.split(',').map((c) => c.trim()) : allowed;
  const out = {};
  for (const c of wanted) {
    if (!allowed.includes(c)) throw new PostgrestError(400, '42703', `column ${c} does not exist`);
    out[c] = row[c] ?? null;
  }
  return out;
}

export function createFakeSupabase({ port = 54321, serverMax = 1000 } = {}) {
  const state = {
    users: new Map(), // id -> { id, email, role, factors, disabled_at, banned_until }
    settings: null,
    auditRows: [], // { id, user_id, actor_email, action, resource_type, resource_id, metadata, ip, created_at }
    requests: [],
    // Namerne greške: ključ je oznaka mesta, vrednost { status, code, message, after } ("after" = posle koliko uspešnih poziva)
    failures: new Map(),
    pageDelayMs: 0,
    serverMax,
  };

  function reset() {
    state.users.clear();
    state.auditRows = [];
    state.requests = [];
    state.failures.clear();
    state.pageDelayMs = 0;
    state.settings = {
      daily_message_limit: 100,
      daily_document_limit: 20,
      daily_token_budget: 1_000_000,
      monthly_token_budget: 20_000_000,
      updated_at: '2026-10-28T10:00:00+00:00',
      updated_by: null,
    };
  }
  reset();

  function addUser(user) {
    state.users.set(user.id, { factors: [], disabled_at: null, banned_until: null, role: 'lawyer', ...user });
    return state.users.get(user.id);
  }

  // Indeks za brzo sortiranje i poređenje velikih skupova
  function setAuditRows(rows) {
    state.auditRows = rows.map((r) => ({ ...r, _us: toMicros(r.created_at) }));
  }

  function caller(req) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token === SERVICE_KEY) return { kind: 'service' };
    if (token === ANON_KEY || token === '') return { kind: 'anon' };
    const claims = decodeJwt(token);
    if (!claims?.sub) return { kind: 'anon' };
    return { kind: 'user', sub: claims.sub, aal: claims.aal ?? null, user: state.users.get(claims.sub) ?? null };
  }

  // private.is_admin(): uloga admin, aal2 i nalog nije blokiran
  const isAdmin = (c) => c.kind === 'user' && c.aal === 'aal2' && c.user?.role === 'admin' && !c.user.disabled_at;

  function json(res, status, body, headers = {}) {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(text);
  }

  function failure(key) {
    const f = state.failures.get(key);
    if (!f) return null;
    f.seen = (f.seen ?? 0) + 1;
    return f.seen > (f.after ?? 0) ? f : null;
  }

  function sendError(res, err) {
    if (err instanceof PostgrestError) return json(res, err.status, { code: err.code, details: null, hint: null, message: err.message });
    console.error('[fake-supabase]', err);
    return json(res, 500, { code: 'XX000', message: String(err) });
  }

  // Telo se beleži u zapis zahteva (entry.body), da probe mogu da provere TAČNO šta je aplikacija poslala
  async function readBody(req, entry) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : undefined;
    entry.body = body;
    return body;
  }

  function selectAudit(c, url, req) {
    if (c.kind === 'anon') throw new PostgrestError(401, '42501', 'permission denied for table audit_log');
    let rows = state.auditRows;
    // RLS (audit_log_select_own_or_admin): svoje zapise ili sve ako je private.is_admin()
    if (c.kind === 'user' && !isAdmin(c)) rows = rows.filter((r) => r.user_id === c.sub);

    const q = url.searchParams;
    for (const [name, values] of [...new Set(q.keys())].map((k) => [k, q.getAll(k)])) {
      if (['select', 'order', 'limit', 'offset', 'or'].includes(name)) continue;
      if (!AUDIT_COLUMNS.includes(name)) throw new PostgrestError(400, 'PGRST204', `unknown column ${name}`);
      for (const value of values) {
        const m = /^(eq|neq|lt|lte|gt|gte)\.(.*)$/s.exec(value);
        if (!m) throw new PostgrestError(400, 'PGRST100', `bad filter ${name}=${value}`);
        rows = rows.filter((r) => COMPARE[m[1]](compareValues(name, r[name], m[2])));
      }
    }
    for (const value of q.getAll('or')) {
      const tree = parseLogic(value);
      rows = rows.filter((r) => evalNode(tree, r));
    }

    // Upit za brojanje nema order; kad postoji, podržan je samo redosled koji aplikacija koristi
    const order = q.get('order');
    if (order !== null) {
      if (order !== 'created_at.desc,id.desc') {
        throw new PostgrestError(400, 'PGRST100', `fake supports only order=created_at.desc,id.desc, got ${order}`);
      }
      rows = [...rows].sort((a, b) => (a._us === b._us ? (a.id < b.id ? 1 : -1) : a._us < b._us ? 1 : -1));
    }

    const total = rows.length;
    const limit = Math.min(q.has('limit') ? Number(q.get('limit')) : Infinity, state.serverMax);
    const offset = q.has('offset') ? Number(q.get('offset')) : 0;
    rows = rows.slice(offset, offset + limit);
    const out = rows.map((r) => pickColumns(r, q.get('select'), AUDIT_COLUMNS));
    return { rows: out, total, offset };
  }

  async function handleRest(req, res, url, entry) {
    const table = url.pathname.replace('/rest/v1/', '');
    const c = caller(req);
    const wantsObject = /vnd\.pgrst\.object/.test(req.headers.accept ?? '');
    const wantsCount = /count=exact/.test(req.headers.prefer ?? '');

    function sendRows(rows, extra = {}) {
      const headers = {};
      if (wantsCount) headers['Content-Range'] = rows.length ? `${extra.offset ?? 0}-${(extra.offset ?? 0) + rows.length - 1}/${extra.total}` : `*/${extra.total}`;
      if (wantsObject) {
        if (rows.length !== 1) throw new PostgrestError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
        return json(res, 200, rows[0], headers);
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
        return res.end();
      }
      return json(res, 200, rows, headers);
    }

    if (table === 'audit_log' && req.method === 'POST') {
      if (c.kind !== 'service') throw new PostgrestError(403, '42501', 'permission denied for table audit_log');
      const f = failure('insert_audit');
      if (f) throw new PostgrestError(f.status ?? 500, f.code ?? 'XX000', f.message ?? 'insert failed');
      const body = await readBody(req, entry);
      const now = BigInt(Date.now()) * 1000n;
      for (const row of Array.isArray(body) ? body : [body]) {
        state.auditRows.push({ id: crypto.randomUUID(), ...row, created_at: formatTs(now), _us: now });
      }
      res.writeHead(201);
      return res.end();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new PostgrestError(405, 'PGRST000', `unsupported ${req.method} ${table}`);

    if (table === 'audit_log') {
      // Brojanje (Prefer: count=exact) i čitanje strane imaju odvojene namerne greške
      const isPage = !wantsCount;
      const f = failure(isPage ? 'select_audit' : 'select_audit_count');
      if (f) throw new PostgrestError(f.status ?? 500, f.code ?? 'XX000', f.message ?? 'select failed');
      if (isPage && state.pageDelayMs) await new Promise((r) => setTimeout(r, state.pageDelayMs));
      const { rows, total, offset } = selectAudit(c, url, req);
      return sendRows(rows, { total, offset });
    }

    if (table === 'profiles') {
      if (c.kind === 'anon') throw new PostgrestError(401, '42501', 'permission denied for table profiles');
      const idFilter = /^eq\.(.+)$/.exec(url.searchParams.get('id') ?? '');
      const found = [...state.users.values()].filter((u) => (!idFilter || u.id === idFilter[1]) && (c.kind === 'service' || u.id === c.sub));
      const rows = found.map((u) => pickColumns(u, url.searchParams.get('select'), ['id', 'role', 'disabled_at', 'email']));
      return sendRows(rows, { total: rows.length });
    }

    if (table === 'office_settings') {
      if (c.kind === 'anon') throw new PostgrestError(401, '42501', 'permission denied for table office_settings');
      const row = pickColumns(state.settings, url.searchParams.get('select'), Object.keys(state.settings));
      return sendRows([row], { total: 1 });
    }

    if (table === 'documents') {
      if (c.kind === 'anon') throw new PostgrestError(401, '42501', 'permission denied for table documents');
      return sendRows([], { total: 0 });
    }

    throw new PostgrestError(404, 'PGRST205', `fake: tabela ${table} nije podržana`);
  }

  async function handleRpc(req, res, url, entry) {
    const name = url.pathname.replace('/rest/v1/rpc/', '');
    const c = caller(req);
    const body = (await readBody(req, entry)) ?? {};

    if (name === 'admin_list_users') {
      const f = failure('rpc_admin_list_users');
      if (f) throw new PostgrestError(f.status ?? 500, f.code ?? 'XX000', f.message ?? 'rpc failed');
      if (!isAdmin(c)) throw new PostgrestError(403, '42501', 'Zabranjeno.');
      return json(
        res,
        200,
        [...state.users.values()].map((u) => ({
          id: u.id,
          email: u.email,
          full_name: u.full_name ?? null,
          role: u.role,
          created_at: '2026-09-01T10:00:00+00:00',
          invited_at: null,
          email_confirmed_at: '2026-09-01T10:05:00+00:00',
          last_sign_in_at: null,
          banned_until: u.banned_until,
          disabled_at: u.disabled_at,
          has_mfa: u.factors.some((x) => x.status === 'verified'),
          documents_count: 0,
          chats_count: 0,
          daily_messages: 0,
          daily_documents: 0,
          daily_tokens: 0,
          monthly_tokens: 0,
        })),
      );
    }

    if (name === 'admin_update_settings') {
      const f = failure('rpc_admin_update_settings');
      if (f) throw new PostgrestError(f.status ?? 400, f.code ?? 'XX000', f.message ?? 'rpc failed');
      if (!isAdmin(c)) throw new PostgrestError(403, '42501', 'Zabranjeno.');
      const keys = ['p_daily_message_limit', 'p_daily_document_limit', 'p_daily_token_budget', 'p_monthly_token_budget'];
      if (keys.some((k) => !(k in body))) throw new PostgrestError(404, 'PGRST202', 'Could not find the function public.admin_update_settings with those parameters');
      if (keys.some((k) => body[k] === null)) throw new PostgrestError(400, '22023', 'Sva podešavanja moraju imati vrednost.');
      const [dm, dd, dt, mt] = keys.map((k) => body[k]);
      if (!(dm >= 1 && dm <= 10000 && dd >= 1 && dd <= 1000 && dt > 0 && mt > 0)) {
        throw new PostgrestError(400, '23514', 'new row violates check constraint');
      }
      const old = { daily_message_limit: state.settings.daily_message_limit, daily_document_limit: state.settings.daily_document_limit, daily_token_budget: state.settings.daily_token_budget, monthly_token_budget: state.settings.monthly_token_budget };
      Object.assign(state.settings, { daily_message_limit: dm, daily_document_limit: dd, daily_token_budget: dt, monthly_token_budget: mt, updated_by: c.sub });
      const now = BigInt(Date.now()) * 1000n;
      state.auditRows.push({
        id: crypto.randomUUID(),
        user_id: c.sub,
        actor_email: c.user.email,
        action: 'settings_changed',
        resource_type: 'settings',
        resource_id: null,
        metadata: { old, new: { daily_message_limit: dm, daily_document_limit: dd, daily_token_budget: dt, monthly_token_budget: mt } },
        ip: null,
        created_at: formatTs(now),
        _us: now,
      });
      res.writeHead(204);
      return res.end();
    }

    throw new PostgrestError(404, 'PGRST202', `fake: funkcija ${name} nije podržana`);
  }

  function handleAuth(req, res, url) {
    if (url.pathname === '/auth/v1/user') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const claims = decodeJwt(token);
      const user = claims?.sub ? state.users.get(claims.sub) : null;
      if (!user) return json(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      return json(res, 200, {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        factors: user.factors,
        banned_until: user.banned_until,
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-09-01T10:00:00Z',
      });
    }
    return json(res, 404, { code: 404, msg: `fake auth: ${url.pathname}` });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const c = url.pathname.startsWith('/rest/') ? caller(req) : { kind: 'auth' };
    const entry = {
      n: state.requests.length,
      method: req.method,
      path: url.pathname,
      search: url.search,
      params: url.searchParams,
      caller: c.kind === 'user' ? { kind: 'user', sub: c.sub, aal: c.aal } : { kind: c.kind },
      prefer: req.headers.prefer ?? '',
      at: Date.now(),
      body: undefined,
    };
    state.requests.push(entry);
    try {
      if (url.pathname.startsWith('/auth/')) return handleAuth(req, res, url);
      if (url.pathname.startsWith('/rest/v1/rpc/')) return await handleRpc(req, res, url, entry);
      if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url, entry);
      return json(res, 404, { message: `fake: ${url.pathname}` });
    } catch (err) {
      return sendError(res, err);
    }
  });

  return {
    state,
    reset,
    addUser,
    setAuditRows,
    start: () => new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve)),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
    // Pozivi ka REST-u od oznake `from` (indeks u state.requests), samo za datu tabelu/funkciju
    calls: (matcher, from = 0) => state.requests.slice(from).filter((r) => matcher(r)),
    mark: () => state.requests.length,
  };
}
