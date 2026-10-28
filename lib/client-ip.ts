import { isIP } from 'node:net';

// IP klijenta za audit log i IP burst limit (2.8).
// Na Vercel-u platforma sama postavlja x-forwarded-for (klijent ne može da ga podmetne), pa mu verujemo
// samo tada. Van Vercel-a (lokalno, drugi hosting) zaglavlje je pod kontrolom klijenta, pa vraćamo null.
export function getClientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL !== '1') return null;
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first && isIP(first) ? first : null;
}
