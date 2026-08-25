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
  closing_momo numeric not null default 0,
  mpesa_cash_in numeric not null default 0
);

-- M-Pesa is recorded as the day's cash-in total from transaction messages,
-- not as an opening/closing account balance.
alter table day_cash add column if not exists mpesa_cash_in numeric not null default 0;
update day_cash
set mpesa_cash_in = closing_momo - opening_momo
where mpesa_cash_in = 0 and (opening_momo <> 0 or closing_momo <> 0);

-- Staff shifts, multiple rows per day.
create table if not exists day_shifts (
  id uuid primary key default gen_random_uuid(),
  day_date date not null,
  staff_name text not null default '',
  hours numeric not null default 0
);
create index if not exists idx_day_shifts_date on day_shifts(day_date);

-- Shift start/end time, so hours worked can be calculated automatically
-- instead of typed in by hand. Added as a migration so re-running this
-- file on an existing project is safe and just adds the two columns.
alter table day_shifts add column if not exists time_in time;
alter table day_shifts add column if not exists time_out time;
alter table day_shifts add column if not exists time_in_at timestamptz;
alter table day_shifts add column if not exists time_out_at timestamptz;

-- Stock movement, one row per item per day.
create table if not exists stock_entries (
  id uuid primary key default gen_random_uuid(),
  day_date date not null,
  item_id uuid not null references items(id) on delete cascade,
  opening numeric not null default 0,
  added numeric not null default 0,
  closing numeric not null default 0,
  recorded_at timestamptz,
  unique (day_date, item_id)
);
alter table stock_entries add column if not exists recorded_at timestamptz;
create index if not exists idx_stock_entries_date on stock_entries(day_date);

-- Daily operating expenses (rent, transport, repairs, etc.), one row per
-- expense entry, several possible per day. Subtracted from net profit.
create table if not exists day_expenses (
  id uuid primary key default gen_random_uuid(),
  day_date date not null,
  description text not null default '',
  amount numeric not null default 0,
  category text not null default 'Other'
);
create index if not exists idx_day_expenses_date on day_expenses(day_date);

-- Customer credit ("on the tab") — money customers owe the pub.
create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  date_incurred date not null,
  original_amount numeric not null default 0,
  notes text default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_debts_date on debts(date_incurred);

-- Payments received against a debt, over time (a debt can be paid off
-- gradually across several days).
create table if not exists debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references debts(id) on delete cascade,
  date_paid date not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_debt_payments_debt on debt_payments(debt_id);
create index if not exists idx_debt_payments_date on debt_payments(date_paid);

-- Row Level Security: ON, with NO public policies.
-- Only the secret service_role key (used by your backend only, never the
-- browser) can bypass RLS and read/write. This keeps the database locked
-- down even though the app itself has no login.
alter table items enable row level security;
alter table day_cash enable row level security;
alter table day_shifts enable row level security;
alter table stock_entries enable row level security;
alter table day_expenses enable row level security;
alter table debts enable row level security;
alter table debt_payments enable row level security;
