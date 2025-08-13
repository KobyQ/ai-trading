// ✅ apps/web/lib/supabase.ts (singleton, browser-safe)
'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Keep a single instance during dev HMR
const g = globalThis as unknown as { __supabase?: SupabaseClient };

export const supabase: SupabaseClient =
  g.__supabase ??
  createClient(url, anon, {
    auth: {
      persistSession: true,
      storageKey: 'mvp-auth', // give it a unique key
      autoRefreshToken: true,
    },
  });

if (process.env.NODE_ENV !== 'production') {
  g.__supabase = supabase;
}