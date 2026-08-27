create table if not exists public.monthly_profit (
  month text primary key,
  sales_amount numeric not null default 0,
  logistics_amount numeric not null default 0,
  labor_amount numeric not null default 0,
  rent_amount numeric not null default 0,
  utilities_amount numeric not null default 0,
  ads_amount numeric not null default 0,
  other_amount numeric not null default 0,
  profit_amount numeric not null default 0,
  profit_rate numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.monthly_profit enable row level security;

create policy "monthly_profit_read" on public.monthly_profit
for select to anon using (true);

create policy "monthly_profit_insert" on public.monthly_profit
for insert to anon with check (true);

create policy "monthly_profit_update" on public.monthly_profit
for update to anon using (true) with check (true);
