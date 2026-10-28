import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Admin klijent (service_role) koji ima pune privilegije na backendu za upis vektora.
// Pravi se tek pri prvom korišćenju, a ne pri učitavanju modula: `next build` učitava
// rute da bi pročitao konfiguraciju, pa bi provera ovde rušila build kada tajni ključ
// nije dostupan u build okruženju. Bez ključa i dalje puca, ali tek u zahtevu.
let client: SupabaseClient | undefined;

function getSupabaseAdmin(): SupabaseClient {
  if (!client) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Nedostaju NEXT_PUBLIC_SUPABASE_URL ili SUPABASE_SERVICE_ROLE_KEY u env varijablama!');
    }
    client = createClient(supabaseUrl, supabaseServiceKey);
  }
  return client;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getSupabaseAdmin();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
