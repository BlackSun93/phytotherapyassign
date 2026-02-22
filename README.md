# Phytotherapy Assignment Platform

Very simple submission platform for student teams:
- Student page: choose an available drug, submit group/leader/students.
- Drug lock: first submission gets the drug (unique constraint in DB).
- Admin page: no login, only URL token (e.g. `/admin?token=...`) to edit submissions and drugs.

## 1) Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor and run:
   - `/Users/mohamedosama/phytotherapyassign/supabase/schema.sql`
3. Copy your project URL and service role key from Supabase project settings.

## 2) Project Setup

1. Create env file:
```bash
cp /Users/mohamedosama/phytotherapyassign/.env.example /Users/mohamedosama/phytotherapyassign/.env
```
2. Edit `/Users/mohamedosama/phytotherapyassign/.env` with real values:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_DASHBOARD_TOKEN`

## 3) Add Your Logo

Place your logo file as:
- `/Users/mohamedosama/phytotherapyassign/public/logo.png`

The pages already render this file next to the main title.

## 4) Run

```bash
cd /Users/mohamedosama/phytotherapyassign
npm start
```

Open:
- Student page: [http://localhost:3000](http://localhost:3000)
- Admin page: `http://localhost:3000/admin?token=YOUR_ADMIN_DASHBOARD_TOKEN`

## Notes

- Team constraints in this version:
  - `Group Number`: 1..4
  - `Team Number`: 1..20
- Students are stored as JSON (`student_id`, `student_name`).
- Admin can add/edit/delete submissions and drugs.
