# Phytotherapy Assignment Platform

Simple 2-page flow for student teams:
- Page 1 (`/`): choose one available drug from a visual card list.
- Page 2 (`/team`): submit team, leader info, and students.
- Drug list is hardcoded in the backend.
- Database is used only to save submissions and lock selected drugs.

## Database (Neon via Vercel Marketplace)

1. Create/connect a Neon database from Vercel Marketplace.
2. In Neon SQL editor, run:
   - `/Users/mohamedosama/phytotherapyassign/supabase/schema.sql`
3. If you are migrating an older DB version, run:
   - `/Users/mohamedosama/phytotherapyassign/supabase/migrate_to_hardcoded_drugs.sql`

## Environment Variables

Set these locally in `.env` and in Vercel project settings:
- `DATABASE_URL` (or `POSTGRES_URL` from Vercel Marketplace Neon)
- `ADMIN_DASHBOARD_TOKEN`

Optional:
- `PORT` (local only)

Copy template:
```bash
cp /Users/mohamedosama/phytotherapyassign/.env.example /Users/mohamedosama/phytotherapyassign/.env
```

## Run Locally

```bash
cd /Users/mohamedosama/phytotherapyassign
npm install
npm start
```

Open:
- Drug list: [http://localhost:3000](http://localhost:3000)
- Team form: [http://localhost:3000/team](http://localhost:3000/team)
- Admin: `http://localhost:3000/admin?token=YOUR_ADMIN_DASHBOARD_TOKEN`

## Deploy To Vercel

This repo includes `/Users/mohamedosama/phytotherapyassign/vercel.json`, routing all paths (including `/api/*`) to `server.js`.

After setting env vars, deploy branch `main`.

## Notes

- Hardcoded 20-drug list is in `/Users/mohamedosama/phytotherapyassign/server.js` (`HARDCODED_DRUGS`).
- Team number range is `1..20`.
- Students are stored as JSON (`student_id`, `student_name`).
- Admin can add/edit/delete submissions only.
