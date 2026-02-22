create extension if not exists pgcrypto;

create table if not exists public.drugs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.group_submissions (
  id uuid primary key default gen_random_uuid(),
  course_group smallint not null check (course_group between 1 and 4),
  team_number smallint not null check (team_number between 1 and 20),
  leader_name text not null,
  leader_email text not null,
  leader_phone text not null,
  students jsonb not null,
  drug_id uuid not null references public.drugs(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint group_submissions_drug_id_key unique (drug_id),
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

alter table public.drugs enable row level security;
alter table public.group_submissions enable row level security;

insert into public.drugs (name)
values
  ('Aspirin'),
  ('Paracetamol'),
  ('Ibuprofen'),
  ('Metformin'),
  ('Atorvastatin'),
  ('Omeprazole'),
  ('Amoxicillin'),
  ('Azithromycin'),
  ('Captopril'),
  ('Enalapril'),
  ('Losartan'),
  ('Furosemide'),
  ('Hydrochlorothiazide'),
  ('Salbutamol'),
  ('Prednisolone'),
  ('Diclofenac'),
  ('Warfarin'),
  ('Clopidogrel'),
  ('Insulin'),
  ('Levothyroxine')
on conflict (name) do nothing;
