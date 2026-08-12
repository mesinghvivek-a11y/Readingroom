# Readingroom — setup & deployment

Three portals (Owner, Student, Admin) wired into one app at:
- `/owner` — library owner dashboard
- `/student` — student booking portal
- `/admin` — subscription approval & plans

All three share one database, so a booking made in `/student` shows up instantly in `/owner`, etc.

---

## 1. Create the database (Supabase — free tier)

1. Go to https://supabase.com → New project. Pick any name/region, set a database password (save it somewhere).
2. Once it's created, open the **SQL Editor** (left sidebar) → New query → paste this and run it:

```sql
create table app_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

alter table app_kv enable row level security;

-- Prototype-level policy: anyone with your anon key can read/write.
-- Fine for testing. Before real customer data goes in, tighten this
-- (e.g. require a real logged-in Supabase Auth user, or move sensitive
-- writes behind a server function).
create policy "public read write" on app_kv
  for all using (true) with check (true);
```

3. Go to **Project Settings → API**. Copy:
   - **Project URL** → this is `VITE_SUPABASE_URL`
   - **anon public** key → this is `VITE_SUPABASE_ANON_KEY`

---

## 2. Run it locally (optional, to test before deploying)

```bash
npm install
cp .env.example .env
# paste your Supabase URL + anon key into .env
npm run dev
```

Open `http://localhost:5173` — you should see the landing page with three cards.

---

## 3. Push to GitHub

```bash
git init
git add .
git commit -m "Readingroom — owner, student, admin portals"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

---

## 4. Deploy on Netlify

1. https://app.netlify.com → **Add new site → Import an existing project → GitHub** → pick this repo.
2. Build settings are already set via `netlify.toml` (build command `npm run build`, publish `dist`) — just confirm and continue.
3. Before the first deploy, go to **Site configuration → Environment variables** and add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. You'll get a free URL like `https://random-name-123.netlify.app` — this is enough to fully test the whole flow (register a library as admin plan → owner signs up → student books → owner approves) with zero risk to your existing site.

---

## 5. Point a subdomain at it (when ready)

Since your main domain already runs another site, use a **subdomain** — it won't affect your existing site at all:

1. In Netlify: **Domain management → Add a domain** → enter e.g. `library.yourdomain.com`.
2. Netlify will show you a CNAME record to add.
3. Go to your domain's DNS settings (wherever you bought it — GoDaddy, Namecheap, etc.) and add:
   - Type: `CNAME`
   - Name/Host: `library` (or whatever prefix you chose)
   - Value: the target Netlify gives you (something like `random-name-123.netlify.app`)
4. Wait for DNS to propagate (usually minutes, sometimes a few hours). Netlify auto-provisions HTTPS once it verifies the record.

Your existing site on the bare domain keeps working untouched — this just adds a new address.

If later you want the whole thing on a **different domain entirely**, repeat step 5 with that domain instead — nothing in the app changes.

---

## Testing the full flow once deployed

1. Go to `/admin` → set up the one-time admin account → add a subscription plan (e.g. "Up to 20 seats", 1–20, ₹999, 30 days).
2. Go to `/owner` → register a library with 20 seats, pick that plan, upload any test image as "payment screenshot."
3. Back in `/admin` → Libraries → Pending → Approve.
4. Go to `/student` → register → find your library → book a seat → upload any test image as payment proof.
5. Back in `/owner` → Requests tab → Approve. The seat turns blue (occupied) — check `/student` → My bookings to see it reflected.

---

## Known limitations (prototype-level, worth fixing before real customer data)

- The Supabase policy above is fully open (any anon key holder can read/write everything). Fine for testing; before launch, add real auth or lock writes behind a server function.
- Owner/student/admin passwords are stored in plain text in the database — same caveat, swap for Supabase Auth or hashed passwords before going live.
- Payment "verification" is manual screenshot review throughout — there's no real payment gateway integration.
