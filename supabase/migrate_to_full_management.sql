create extension if not exists pgcrypto;

create table if not exists public.drugs (
  key text primary key,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.drug_reservations (
  drug_key text primary key,
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

alter table public.drug_reservations
  alter column drug_key set not null,
  alter column holder_token set not null,
  alter column expires_at set not null;

delete from public.drug_reservations
where expires_at <= timezone('utc', now());

alter table public.drugs add column if not exists key text;
alter table public.drugs add column if not exists name text;
alter table public.drugs add column if not exists is_active boolean not null default true;
alter table public.drugs add column if not exists sort_order integer not null default 0;
alter table public.drugs add column if not exists created_at timestamptz not null default timezone('utc', now());
alter table public.drugs add column if not exists updated_at timestamptz not null default timezone('utc', now());

with prepared as (
  select
    ctid,
    coalesce(nullif(lower(regexp_replace(coalesce(name, 'drug'), '[^a-z0-9]+', '-', 'g')), ''), 'drug') as base_key,
    row_number() over (
      partition by coalesce(nullif(lower(regexp_replace(coalesce(name, 'drug'), '[^a-z0-9]+', '-', 'g')), ''), 'drug')
      order by ctid
    ) as seq
  from public.drugs
)
update public.drugs d
set key = case
  when p.seq = 1 then p.base_key
  else p.base_key || '-' || p.seq
end
from prepared p
where d.ctid = p.ctid
  and (d.key is null or btrim(d.key) = '');

update public.drugs
set key = lower(key)
where key <> lower(key);

create unique index if not exists drugs_key_unique_idx on public.drugs ((lower(key)));

alter table public.drugs
  alter column key set not null,
  alter column name set not null;

alter table public.group_submissions
  add column if not exists drug_key text,
  add column if not exists drug_name text,
  alter column course_group set default 1;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'group_submissions'
      and column_name = 'drug_id'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'drugs'
        and column_name = 'id'
    ) then
      update public.group_submissions gs
      set
        drug_key = coalesce(gs.drug_key, d.key),
        drug_name = coalesce(gs.drug_name, d.name)
      from public.drugs d
      where gs.drug_id = d.id
        and (gs.drug_key is null or gs.drug_name is null);
    end if;

    update public.group_submissions
    set
      drug_key = coalesce(drug_key, 'legacy-' || substr(coalesce(drug_id::text, gen_random_uuid()::text), 1, 8)),
      drug_name = coalesce(drug_name, 'Legacy Drug')
    where drug_key is null or drug_name is null;

    alter table public.group_submissions alter column drug_id drop not null;
    alter table public.group_submissions drop constraint if exists group_submissions_drug_id_key;
    alter table public.group_submissions drop constraint if exists group_submissions_drug_id_fkey;
  else
    update public.group_submissions
    set
      drug_key = coalesce(drug_key, 'legacy-' || substr(gen_random_uuid()::text, 1, 8)),
      drug_name = coalesce(drug_name, 'Legacy Drug')
    where drug_key is null or drug_name is null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'group_submissions'
      and c.conname = 'group_submissions_drug_key_key'
  ) then
    alter table public.group_submissions
      add constraint group_submissions_drug_key_key unique (drug_key);
  end if;
end;
$$;

alter table public.group_submissions
  alter column drug_key set not null,
  alter column drug_name set not null;

insert into public.drugs (key, name, is_active, sort_order)
select distinct lower(drug_key), drug_name, true, 1000
from public.group_submissions
where drug_key is not null and drug_name is not null
on conflict do nothing;

insert into public.drugs (key, name, is_active, sort_order)
values
  ('drug-01', 'Drug 01', true, 1),
  ('drug-02', 'Drug 02', true, 2),
  ('drug-03', 'Drug 03', true, 3),
  ('drug-04', 'Drug 04', true, 4),
  ('drug-05', 'Drug 05', true, 5),
  ('drug-06', 'Drug 06', true, 6),
  ('drug-07', 'Drug 07', true, 7),
  ('drug-08', 'Drug 08', true, 8),
  ('drug-09', 'Drug 09', true, 9),
  ('drug-10', 'Drug 10', true, 10),
  ('drug-11', 'Drug 11', true, 11),
  ('drug-12', 'Drug 12', true, 12),
  ('drug-13', 'Drug 13', true, 13),
  ('drug-14', 'Drug 14', true, 14),
  ('drug-15', 'Drug 15', true, 15),
  ('drug-16', 'Drug 16', true, 16),
  ('drug-17', 'Drug 17', true, 17),
  ('drug-18', 'Drug 18', true, 18),
  ('drug-19', 'Drug 19', true, 19),
  ('drug-20', 'Drug 20', true, 20)
on conflict (key) do nothing;

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_group_submissions_updated_at on public.group_submissions;
create trigger set_group_submissions_updated_at
before update on public.group_submissions
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists set_drugs_updated_at on public.drugs;
create trigger set_drugs_updated_at
before update on public.drugs
for each row
execute function public.set_updated_at_timestamp();

drop trigger if exists set_drug_reservations_updated_at on public.drug_reservations;
create trigger set_drug_reservations_updated_at
before update on public.drug_reservations
for each row
execute function public.set_updated_at_timestamp();
