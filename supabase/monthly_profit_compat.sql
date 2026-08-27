alter table public.monthly_profit
  add column if not exists sales numeric not null default 0,
  add column if not exists logistics numeric not null default 0,
  add column if not exists delivery_fee numeric not null default 0,
  add column if not exists card_fee numeric not null default 0,
  add column if not exists advertising numeric not null default 0,
  add column if not exists royalty numeric not null default 0,
  add column if not exists gas numeric not null default 0,
  add column if not exists utility numeric not null default 0,
  add column if not exists insurance numeric not null default 0,
  add column if not exists labor numeric not null default 0,
  add column if not exists rent numeric not null default 0,
  add column if not exists torder numeric not null default 0,
  add column if not exists pos numeric not null default 0,
  add column if not exists tax_accountant numeric not null default 0,
  add column if not exists other_fixed numeric not null default 0,
  add column if not exists loan_interest numeric not null default 0,
  add column if not exists other numeric not null default 0,
  add column if not exists memo text default '';

create index if not exists monthly_profit_month_idx on public.monthly_profit(month);