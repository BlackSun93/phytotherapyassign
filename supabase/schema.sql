create extension if not exists pgcrypto;

create table if not exists public.drugs (
  key text primary key,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.group_submissions (
  id uuid primary key default gen_random_uuid(),
  course_group smallint not null default 1 check (course_group between 1 and 4),
  team_number smallint not null check (team_number between 1 and 20),
  leader_name text not null,
  leader_email text not null,
  leader_phone text not null,
  students jsonb not null,
  drug_key text not null,
  drug_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint group_submissions_drug_key_key unique (drug_key),
  constraint group_submissions_course_group_team_number_key unique (course_group, team_number)
);

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
