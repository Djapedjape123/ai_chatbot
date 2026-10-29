// Beogradski kalendarski dani (Europe/Belgrade) i njihove granice u UTC. Čist kod bez server-only importa (npm test).
// Filteri dnevnika aktivnosti rade sa beogradskim datumima (GGGG-MM-DD), a baza čuva UTC. Server radi u UTC,
// pa se pretvaranje ne sme oslanjati na lokalnu zonu servera, niti na pretpostavku da dan ima 24 sata:
// dan prelaza na letnje vreme traje 23 sata, a dan povratka na zimsko 25.

const TIME_ZONE = 'Europe/Belgrade';
const DAY_MS = 24 * 60 * 60 * 1000;

const wallClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function wallClockParts(instant: Date): Record<string, number> {
  const parts = wallClock.formatToParts(instant);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
}

// Koliko je beogradsko zidno vreme ispred UTC u datom trenutku (3.600.000 zimi, 7.200.000 leti)
function offsetMs(instant: Date): number {
  const p = wallClockParts(instant);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Samo stvaran kalendarski datum u obliku GGGG-MM-DD (2026-02-30 ne prolazi)
export function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function dateToUtcMs(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`Neispravan datum: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function utcMsToDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Čisto kalendarsko računanje (bez sata), pa promena sata ne može da ga pomeri
export function addDays(date: string, days: number): string {
  return utcMsToDate(dateToUtcMs(date) + days * DAY_MS);
}

// Broj kalendarskih dana od `from` do `to`, uključujući oba kraja
export function daysInclusive(from: string, to: string): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS) + 1;
}

// Beogradski datum u datom trenutku
export function belgradeDateOf(instant: Date): string {
  const p = wallClockParts(instant);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

// Trenutak (UTC) kada u Beogradu počinje dati dan. Prelazi na letnje/zimsko vreme su u 01:00 UTC, dakle
// nikad u ponoć po beogradskom vremenu, pa ponoć uvek postoji i jedinstvena je. Dva prolaza: prvo se
// pretpostavi pomak u trenutku "ponoć kao da je UTC", pa se proveri u dobijenom trenutku (drugačiji pomak
// znači da je pretpostavka pala na drugu stranu prelaza).
export function belgradeMidnightUtc(date: string): Date {
  const naive = dateToUtcMs(date);
  const first = naive - offsetMs(new Date(naive));
  return new Date(naive - offsetMs(new Date(first)));
}
