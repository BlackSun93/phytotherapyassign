create extension if not exists pgcrypto;

alter table public.group_submissions
  add column if not exists drug_key text,
  add column if not exists drug_name text;

alter table public.group_submissions
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
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'drugs'
    ) then
      update public.group_submissions gs
      set
        drug_key = coalesce(gs.drug_key, lower(replace(d.name, ' ', '-'))),
        drug_name = coalesce(gs.drug_name, d.name)
      from public.drugs d
      where gs.drug_id = d.id
        and (gs.drug_key is null or gs.drug_name is null);
    end if;

    execute $fallback$
      update public.group_submissions
      set
        drug_key = coalesce(drug_key, 'legacy-' || substr(coalesce(drug_id::text, gen_random_uuid()::text), 1, 8)),
        drug_name = coalesce(drug_name, 'Legacy Drug')
      where drug_key is null or drug_name is null
    $fallback$;

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
