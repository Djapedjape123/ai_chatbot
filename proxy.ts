import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from '@/lib/api-error';
import { MFA_REQUIRED_MESSAGE, countVerifiedFactors, decideMfaGate, readAal } from '@/lib/mfa-gate';
import { isPublicPath } from '@/lib/route-access';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Kreiramo Supabase klijenta sa SSR podrškom

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Osvežava token pre nego što istekne
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Preusmerenje ili odbijanje mora da ponese kolačiće koje je Supabase upravo osvežio (setAll iznad).
  // Bez njih bi pregledač zadržao stari refresh token, koji je rotacijom već iskorišćen, i sesija bi se prekinula.
  const withSessionCookies = (target: NextResponse) => {
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return target;
  };

  // 1. Stranice za prijavu (javna registracija je ukinuta: nalog otvara administrator pozivnicom)
  const isAuthPage = pathname === '/login' || pathname === '/forgot-password';

  // 2. Početna (Landing) stranica
  const isHomePage = pathname === '/';

  // PRAVILO 1: Nije ulogovan, a pokušava da ode negde što NIJE javno (lib/route-access.ts) -> baci ga na login.
  // /auth/confirm je javna jer ga otvara odjavljen korisnik sa linka iz emaila (pozivnica, reset lozinke).
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return withSessionCookies(NextResponse.redirect(url));
  }

  // PRAVILO 2 (dvostepena prijava, 2.5.3): nalog sa potvrđenim faktorom, a sa sesijom dobijenom samo lozinkom (aal1),
  // ne ulazi nigde osim na /login/mfa. Stranice se preusmeravaju, a API i server akcije dobijaju 401 mfa_required.
  // Ovo je samo optimistički sloj: isto pravilo važi i u requireUser(), koji koriste rute, akcije i stranice.
  // Faktori stižu iz getUser() iznad (bez dodatnog poziva), a nivo se čita iz tokena samo kad faktor postoji.
  if (user) {
    const verifiedFactors = countVerifiedFactors(user.factors);
    let aal: string | null = null;
    if (verifiedFactors > 0) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      aal = readAal(session?.access_token);
    }

    const gate = decideMfaGate({
      pathname,
      search: request.nextUrl.search,
      method: request.method,
      verifiedFactors,
      aal,
    });
    if (gate.kind === 'deny') {
      return withSessionCookies(apiError(MFA_REQUIRED_MESSAGE, 401, 'mfa_required'));
    }
    if (gate.kind === 'redirect') {
      return withSessionCookies(NextResponse.redirect(new URL(gate.to, request.url)));
    }
  }

  // PRAVILO 3: Ulogovan je, a pokušava da ode na Auth stranice ILI na Landing stranicu -> baci ga na glavni /chat interfejs
  if (user && (isAuthPage || isHomePage)) {
    const url = request.nextUrl.clone();
    url.pathname = '/chat';
    return withSessionCookies(NextResponse.redirect(url));
  }

  return response;
}

// Ova konfiguracija osigurava da se proxy primenjuje na sve rute osim onih koje su eksplicitno izuzete (npr. statički fajlovi, slike, itd.)

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
