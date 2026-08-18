import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

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

  // 1. Stranice za prijavu
  const isAuthPage = 
    pathname === '/login' || 
    pathname === '/register' || 
    pathname === '/forgot-password';

  // 2. Početna (Landing) stranica
  const isHomePage = pathname === '/';

  // 3. Sistemske rute
  const isCallbackRoute = pathname.startsWith('/auth/callback');
  const isResetPage = pathname === '/reset-password';

  // PRAVILO 1: Nije ulogovan, a pokušava da ode negde što NIJE javno (Auth, Landing, Callback, Reset) -> baci ga na login
  if (!user && !isAuthPage && !isHomePage && !isCallbackRoute && !isResetPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // PRAVILO 2: Ulogovan je, a pokušava da ode na Auth stranice ILI na Landing stranicu -> baci ga na glavni /chat interfejs
  if (user && (isAuthPage || isHomePage)) {
    const url = request.nextUrl.clone();
    url.pathname = '/chat';
    return NextResponse.redirect(url);
  }

  return response;
}

// Ova konfiguracija osigurava da se proxy primenjuje na sve rute osim onih koje su eksplicitno izuzete (npr. statički fajlovi, slike, itd.)

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};