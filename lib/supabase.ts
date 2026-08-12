import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Koristimo Service Role Key na backendu kako bismo imali pun pristup za upis vektora
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);