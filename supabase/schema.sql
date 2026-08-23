-- The Day Book — Pub Ledger
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.

create extension if not exists pgcrypto;

-- Stock items with FIXED buying/selling prices, set once via Stock Setup.
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Liquor',
  buying_price numeric not null default 0,
  selling_price numeric not null default 0,
  created_at timestamptz not null default now()
);

-- One cash/mobile-money row per trading day.
create table if not exists day_cash (
  day_date date primary key,
  opening_cash numeric not null default 0,
  closing_cash numeric not null default 0,
  opening_momo numeric not null default 0,
  closing_momo numeric not null default 0
);

-- Staff shifts, multiple rows per day.
create table if not exists day_shifts (
  id uuid primary key default gen_random_uuid(),
  day_date date not null,
  staff_name text not null default '',
  hours numeric not null default 0
);
create index if not exists idx_day_shifts_date on day_shifts(day_date);

-- Stock movement, one row per item per day.
create table if not exists stock_entries (
  id uuid primary key default gen_random_uuid(),
  day_date date not null,
  item_id uuid not null references items(id) on delete cascade,
  opening numeric not null default 0,
  added numeric not null default 0,
  closing numeric not null default 0,
  unique (day_date, item_id)
);
create index if not exists idx_stock_entries_date on stock_entries(day_date);

-- Row Level Security: ON, with NO public policies.
-- Only the secret service_role key (used by your backend only, never the
-- browser) can bypass RLS and read/write. This keeps the database locked
-- down even though the app itself has no login.
alter table items enable row level security;
alter table day_cash enable row level security;
alter table day_shifts enable row level security;
alter table stock_entries enable row level security;
