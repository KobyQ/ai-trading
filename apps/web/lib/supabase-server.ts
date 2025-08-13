import { createClient } from '@supabase/supabase-js';

// use anon key for read-only or light writes; NEVER expose service role to the browser
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function supabaseServer() {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}