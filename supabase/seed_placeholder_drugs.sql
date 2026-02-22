insert into public.drugs (name, is_active)
values
  ('Drug 01', true),
  ('Drug 02', true),
  ('Drug 03', true),
  ('Drug 04', true),
  ('Drug 05', true),
  ('Drug 06', true),
  ('Drug 07', true),
  ('Drug 08', true),
  ('Drug 09', true),
  ('Drug 10', true),
  ('Drug 11', true),
  ('Drug 12', true),
  ('Drug 13', true),
  ('Drug 14', true),
  ('Drug 15', true),
  ('Drug 16', true),
  ('Drug 17', true),
  ('Drug 18', true),
  ('Drug 19', true),
  ('Drug 20', true)
on conflict (name) do update
set is_active = excluded.is_active;
