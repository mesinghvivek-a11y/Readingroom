import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fails loudly in the browser console instead of silently returning empty data everywhere.
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Set them in a .env file locally, " +
    "and in Netlify's Site settings → Environment variables for deployed builds."
  );
}

export const supabase = createClient(url, anonKey);
