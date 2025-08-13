'use client';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const g = globalThis as any;
export const supabase =
  g.__supabase ??
  createClient(url, anon, {
    auth: { persistSession: true, storageKey: 'mvp-auth', autoRefreshToken: true },
  });
if (process.env.NODE_ENV !== 'production') g.__supabase = supabase;