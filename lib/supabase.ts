import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Nedostaju Supabase varijable u .env.local fajlu!');
}
//supabase
// Admin klijent koji ima pune privilegije na backendu za upis vektora
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);