// GET /api/me (2.5.9): jedino što meni treba da zna je da li da prikaže vezu ka admin panelu. Čist kod bez server-only
// uvoza, da bi ga mogli da koriste i ruta i stranica /chat (klijentska komponenta) i da se može testirati (npm test).
//
// Veza samo olakšava ulaz. Stvarnu zaštitu daje panel (404 za advokata, aal2, baza), pa nijedna greška ovde ne otvara ništa.

import { isAdminRole } from './admin-access.ts';

export type MeBody = { role: 'admin' | 'lawyer' };

const field = (value: unknown, name: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined;

// Telo odgovora: samo uloga, ma šta red profila sadrži. Sve što nije tačno 'admin' (nema profila, nepoznata vrednost) je 'lawyer'.
export function toMeBody(profile: unknown): MeBody {
  return { role: isAdminRole(field(profile, 'role')) ? 'admin' : 'lawyer' };
}

// Klijent: vezu otvara samo telo oblika { role: 'admin' }. Greška, prazan ili neočekivan odgovor znače "nije admin".
export function readIsAdmin(data: unknown): boolean {
  return isAdminRole(field(data, 'role'));
}
