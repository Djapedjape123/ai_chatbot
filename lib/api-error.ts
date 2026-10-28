import { NextResponse } from 'next/server';

// Jedinstven oblik greške za sve API rute: { error, code }, poruka na srpskom.
// Odvojeno od lib/validation.ts jer next/server ne može da se učita u npm test (čist Node).
export function apiError(message: string, status = 400, code = 'invalid_request') {
  return NextResponse.json({ error: message, code }, { status });
}
