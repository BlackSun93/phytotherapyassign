# Phytotherapy Assignment Platform

Simple 2-page flow for group registration:
- Page 1 (`/`): choose one available drug from a visual card list.
- Page 2 (`/group`): submit group, leader info, and students.
- Admin page (`/admin`): full management of drugs and group submissions.

## Features

- Drug locking: once a group submits a drug, it becomes taken.
- Temporary reservation lock (lease):
  - `/group` reserves selected drug for 10 minutes.
  - Heartbeat renews reservation every 30 seconds while page is open.
  - Home list marks reserved drugs as unavailable.
  - Submit requires matching reservation token.
- Group submission fields: group number, leader name/email/phone, students (ID + name), selected drug.
- Admin controls:
  - Add/edit/delete drugs
  - Activate/deactivate drugs
  - Reorder drugs with sort order
  - Create/edit/delete group submissions

## Database (Neon via Vercel Marketplace)

Run one of the following in Neon SQL editor:

1. New database:
   - `/Users/mohamedosama/phytotherapyassign/supabase/schema.sql`
2. Existing project migration to full management:
   - `/Users/mohamedosama/phytotherapyassign/supabase/migrate_to_full_management.sql`
3. If you already deployed full management before this reservation update, run:
   - `/Users/mohamedosama/phytotherapyassign/supabase/migrate_add_reservations.sql`

## Environment Variables

Set these locally in `.env` and in Vercel project settings:
- `DATABASE_URL` (or `POSTGRES_URL` from Vercel Marketplace Neon)

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
- Group form: [http://localhost:3000/group](http://localhost:3000/group)
- Admin: `http://localhost:3000/admin`

## Deploy To Vercel

This repo includes `/Users/mohamedosama/phytotherapyassign/vercel.json`, routing all paths (including `/api/*`) to `server.js`.

After setting env vars, deploy branch `main`.
