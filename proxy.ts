import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

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

  // OVO je bitno: osvežava token pre nego što istekne
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // 1. Definišemo stranice za autentifikaciju (na njih ne smeš ako si VEĆ ulogovan)
  const isAuthPage = 
    pathname === '/login' || 
    pathname === '/register' || 
    pathname === '/forgot-password';

  // 2. Definišemo sistemsku rutu za potvrdu linka iz mejla (mora uvek biti dostupna)
  const isCallbackRoute = pathname.startsWith('/auth/callback');

  // 3. DODATO: Dozvoljavamo rutu za promenu lozinke (mora biti dostupna da bi klijent pročitao token)
  const isResetPage = pathname === '/reset-password';

  // Nije ulogovan i pokušava da ode bilo gde osim na Auth stranice, Callback ili Reset -> preusmeri na login
  if (!user && !isAuthPage && !isCallbackRoute && !isResetPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Ulogovan je (ima aktivnu ili recovery sesiju) i pokušava da ode na Auth stranice -> preusmeri na glavni interfejs
  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};