import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
 // 1. Kreiramo Supabase klijent koristeći URL i anon ključ iz okruženja
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // 2. Povezujemo kolačiće sa Supabase klijentom kako bi se sesija mogla održavati između zahteva
      cookies: {
        // 3. Definišemo metode za dobijanje i postavljanje kolačića
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll poziva se iz Server Component-e gde je pisanje kolačića zabranjeno —
            // middleware se brine o osvežavanju sesije u tom slučaju, pa ovo ignorišemo
          }
        },
      },
    }
  );
}