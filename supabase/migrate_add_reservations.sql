create table if not exists public.drug_reservations (
  drug_key text primary key references public.drugs(key) on update cascade on delete cascade,
  holder_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.drug_reservations add column if not exists drug_key text;
alter table public.drug_reservations add column if not exists holder_token text;
alter table public.drug_reservations add column if not exists expires_at timestamptz;
alter table public.drug_reservations add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.drug_reservations add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.drug_reservations
set drug_key = lower(drug_key)
where drug_key is not null and drug_key <> lower(drug_key);

create unique index if not exists drug_reservations_drug_key_unique_idx on public.drug_reservations ((lower(drug_key)));
create index if not exists drug_reservations_expires_at_idx on public.drug_reservations (expires_at);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_drug_reservations_updated_at on public.drug_reservations;
create trigger set_drug_reservations_updated_at
before update on public.drug_reservations
for each row
execute function public.set_updated_at_timestamp();

alter table public.drug_reservations
  alter column drug_key set not null,
  alter column holder_token set not null,
  alter column expires_at set not null;

-- Remove stale rows immediately during migration.
delete from public.drug_reservations
where expires_at <= timezone('utc', now());
