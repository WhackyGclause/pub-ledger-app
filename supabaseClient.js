// supabaseClient.js — connects to your hosted Supabase Postgres database.
// Keys are read from .env (never commit .env — see .env.example).

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn(
    '⚠️  SUPABASE_URL or SUPABASE_SERVICE_KEY is missing from your .env file.\n' +
    '   Copy .env.example to .env and fill in your project values.'
  );
}
if (process.env.SUPABASE_SERVICE_KEY && process.env.SUPABASE_SERVICE_KEY.startsWith('sb_publishable')) {
  console.warn('⚠️  SUPABASE_SERVICE_KEY is a publishable key. Use the Supabase secret/service_role key so the backend can write data.');
}

// IMPORTANT: this uses the SERVICE ROLE (secret) key, which bypasses Row
// Level Security. It must only ever be used here, on the backend. Never
// send this key to the browser/frontend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

module.exports = supabase;
