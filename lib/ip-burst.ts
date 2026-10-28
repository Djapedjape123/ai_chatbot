import { isIP } from 'node:net';
import { positiveInt } from './limits.ts';

// IP burst zaštita (2.8): fiksni prozor po IP adresi, brojač u Postgres-u (hit_ip_rate_limit iz migracije 2.1).
// Štiti od poplave zahteva i od ponavljanja neispravnih otpremanja, koja ne troše ledger, a pune audit log.
// Dnevne limite po advokatu čuva ledger (lib/usage.ts); ovo je samo gruba brana po mreži.
// Bez server-only importa, da bi se odluka mogla testirati (npm test).

export const IP_BURST_WINDOW_SECONDS = 60;

// Cela kancelarija je obično iza jedne IP adrese (NAT), pa limit mora da trpi više advokata istovremeno.
// Jedan brojač važi za /api/chat i /api/ingest zajedno.
export const DEFAULT_IP_BURST_LIMIT = 60;

type Env = Record<string, string | undefined>;

// Neispravna vrednost tiho pada na podrazumevanu: greška u env-u ne sme da isključi limit.
export function getIpBurstLimit(env: Env = process.env): number {
  return positiveInt(env.IP_BURST_LIMIT, DEFAULT_IP_BURST_LIMIT);
}

// Za Retry-After: prozor je fiksan (poravnat na epohu), kao u hit_ip_rate_limit.
export function secondsUntilNextWindow(nowMs: number, windowSeconds: number = IP_BURST_WINDOW_SECONDS): number {
  const windowMs = windowSeconds * 1000;
  const nextWindowStart = (Math.floor(nowMs / windowMs) + 1) * windowMs;
  return Math.max(1, Math.ceil((nextWindowStart - nowMs) / 1000));
}

// Šta se broji. IPv6 klijent obično dobija celu /64 mrežu, pa bi rotacija adresa unutar nje zaobišla limit:
// brojimo po /64. IPv4 upakovan u IPv6 (::ffff:a.b.c.d) vraćamo na IPv4, inače bi svi delili isti ključ.
// Ulaz mora da prođe isIP (getClientIp to garantuje).
export function ipBurstKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;

  let text = ip.toLowerCase();
  if (text.includes('.')) {
    // Završni IPv4 zapis (a.b.c.d) zauzima dve grupe
    const split = text.lastIndexOf(':');
    const [a, b, c, d] = text.slice(split + 1).split('.').map(Number);
    text = `${text.slice(0, split + 1)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }

  const [head, tail] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  const groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups].map((g) => parseInt(g, 16));

  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(':')}:0:0:0:0/64`;
}

export type IpBurstDecision =
  | { kind: 'allow' }
  | { kind: 'blocked'; retryAfterSeconds: number }
  | { kind: 'unavailable' };

// Poziv baze (RPC hit_ip_rate_limit) se prosleđuje spolja: odluka ostaje čista i proverljiva.
export type HitIpRateLimit = (
  key: string,
  limit: number,
  windowSeconds: number
) => Promise<{ data: unknown; error: unknown }>;

export async function decideIpBurst(
  ip: string | null,
  hit: HitIpRateLimit,
  nowMs: number = Date.now(),
  env: Env = process.env
): Promise<IpBurstDecision> {
  // Bez poverljive IP adrese (van Vercel-a, vidi lib/client-ip.ts) nema po čemu da se broji.
  if (!ip) return { kind: 'allow' };

  try {
    const { data, error } = await hit(ipBurstKey(ip), getIpBurstLimit(env), IP_BURST_WINDOW_SECONDS);
    // FAIL-CLOSED: bez jasnog odgovora baze zahtev ne prolazi.
    if (error || typeof data !== 'boolean') return { kind: 'unavailable' };
    return data ? { kind: 'allow' } : { kind: 'blocked', retryAfterSeconds: secondsUntilNextWindow(nowMs) };
  } catch {
    return { kind: 'unavailable' };
  }
}
