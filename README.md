# The Day Book — Pub Ledger

A daily stock, shift and cash-reconciliation ledger for a local pub.
Backend: Node.js + Express. Frontend: plain HTML/CSS/JS, installable as an
app (PWA). Data is stored in a hosted **Supabase Postgres** database (free
tier) — no login required, reachable from anywhere once deployed.

## What it does

- **Day Sheet** — record staff on shift and hours worked, opening/added/closing
  stock for every counter item (liquor, both snuff types, khat, soft drinks),
  and opening/closing cash and mobile money. Revenue, cost, net profit and
  total balance are calculated automatically.
- **Discrepancy stamp** — compares cash+mobile money actually collected
  against what the stock movement says should have sold, and marks the day
  **Balanced**, **Shortfall**, or **Over** — your loss/theft indicator.
- **Stock Setup** — every item has a **fixed buying price and selling
  price**, set once. Every day sheet reuses these automatically.
- **Sales History** — every saved day, click through to reopen one.
- **Balance Sheet** — cumulative profit/loss chart and totals, always
  current to the latest saved day.
- **Installable app** — visitors can install it to their phone/desktop home
  screen straight from the browser, no app store needed.

---

## 1. Prerequisites

Install **Node.js** (version 18+): https://nodejs.org — download the LTS
version and run the installer. Verify with:
```bash
node -v
npm -v
```

## 2. Create your free Supabase project

1. Go to https://supabase.com and sign up (free, no card required).
2. **New project** → pick a name, set a database password (save it
   somewhere safe), choose your region, create. Takes a minute or two.
3. Open **SQL Editor** → **New query**, paste the entire contents of
   `supabase/schema.sql` from this project, and click **Run**. This creates
   the `items`, `day_cash`, `day_shifts`, and `stock_entries` tables.
4. Go to **Settings → API** (or **Settings → API Keys** on newer projects).
   You need two values:
   - **Project URL** — looks like `https://xxxxx.supabase.co`
   - **service_role secret key** (or, on newer projects, the **Secret key**
     under "Publishable and secret API keys" — starts with `sb_secret_...`).
     **Not** the anon/publishable key.

⚠️ The secret key gives full database access and bypasses all security
rules. It goes in `.env` on your backend only — never in frontend code, a
public repo, or shared anywhere.

## 3. Get the project into VS Code

1. Unzip the project folder anywhere, e.g. `Documents/pub-ledger-app`.
2. VS Code → **File → Open Folder…** → select `pub-ledger-app`.
3. Open the terminal: **Terminal → New Terminal**.

## 4. Configure environment variables

```bash
cp .env.example .env
```
(On Windows, duplicate `.env.example` in File Explorer and rename it to `.env`.)

Open `.env` and fill in your two Supabase values:
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=your-secret-key-here
PORT=3000
```
`.env` is already in `.gitignore` — it will never be committed.

## 5. Install and run locally

```bash
npm install
npm start
```
Open http://localhost:3000. Set up your stock items and fixed prices in
**Stock Setup** first, then start recording days.

---

## 6. Deploying it live (Render.com, free)

This makes the app reachable from any device, and is required for the
"Install app" feature to work for anyone but you (installability needs a
real HTTPS address — `localhost` only installs on the same computer).

1. Push this project to a GitHub repository. **Do not commit `.env`** — it's
   already gitignored.
   ```bash
   git init
   git add .
   git commit -m "Pub ledger app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. Sign up at https://render.com → **New → Web Service** → connect your
   GitHub repo.
3. **Build command:** `npm install`. **Start command:** `npm start`.
4. Under **Environment**, add the same variables from your local `.env`:
   `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
5. Deploy. Render builds and gives you a free public HTTPS URL like
   `https://your-app-name.onrender.com`.

That's it — the database is already hosted on Supabase, so Render doesn't
need any storage of its own. Free tier note: the service may sleep after
15 minutes of inactivity and take a few seconds to wake up on the next
visit — normal for free hosting, and doesn't affect your saved data.

## 7. Installing it as an app ("downloadable")

Once deployed, anyone who opens the Render URL can install it like a real
app — no app store, no APK file:

**On Android (Chrome):**
- Open the site → tap the **⋮** menu → **Install app** (or **Add to Home
  screen**). A banner offering this also appears automatically inside the
  app itself.
- It then opens full-screen from the home screen icon, like a native app.

**On desktop (Chrome/Edge):**
- Open the site → click the **install icon** (⊕ or a small monitor icon) in
  the address bar → **Install**.

**On iPhone (Safari):**
- Open the site → **Share** button → **Add to Home Screen**. (iOS Safari
  doesn't show an automatic install prompt like Android/desktop Chrome, so
  this manual step is required there.)

**What "installed" actually means here:** the app shell (layout, styling,
navigation) loads instantly from the device even on a poor connection,
because it's cached by a service worker. Actual stock/cash/sales data
always requires an internet connection to Supabase — this is intentional,
so you're never looking at stale financial figures. It's an installable
web app, not an offline-capable one for data entry.

---

## Project structure

```
pub-ledger-app/
├── server.js              # Express server + all API routes
├── db.js                  # data access layer — talks to Supabase Postgres
├── supabaseClient.js       # creates the Supabase connection using .env
├── supabase/
│   └── schema.sql            # run once in Supabase's SQL Editor
├── .env.example               # template — copy to .env and fill in your keys
├── package.json
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js                 # frontend logic, talks to the API via fetch()
│   ├── manifest.json           # PWA manifest (name, icons, colors)
│   ├── sw.js                   # service worker — caches the app shell only
│   └── icons/
│       ├── icon-192.png
│       ├── icon-512.png
│       └── apple-touch-icon.png
└── README.md
```

## API reference

| Method | Route              | Purpose                                   |
|--------|---------------------|--------------------------------------------|
| GET    | /api/items          | list all stock items                       |
| POST   | /api/items          | add a stock item                           |
| PUT    | /api/items/:id       | edit a stock item                          |
| DELETE | /api/items/:id       | remove a stock item                        |
| GET    | /api/days/:date      | get one day's full record                  |
| PUT    | /api/days/:date      | save/overwrite one day's full record       |
| GET    | /api/days            | list summary totals for every saved day    |
| GET    | /api/balance-sheet   | cumulative totals + trend for all days     |

## Backing up your data

Supabase backs up its hosted Postgres automatically on its own schedule
(Dashboard → **Database → Backups** shows what's included on your plan).
For an extra local copy any time, use `pg_dump` with the connection string
from **Settings → Database**, or export via the SQL Editor.

## Troubleshooting

- **"supabaseUrl is required" crash on startup** — `.env` is missing or
  incomplete. Confirm both `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set.
- **"Port 3000 already in use"** — run `PORT=4000 npm start` instead.
- **No install prompt appears** — Chrome only shows it over HTTPS (or
  localhost) and only after some engagement with the site; on iOS use
  Share → Add to Home Screen manually (see above).
- **Changes to prices not showing on Day Sheet** — prices are fixed at the
  item level; edit them in Stock Setup, then reload the Day Sheet.
- **API errors mentioning permissions/RLS** — double check you used the
  **service_role / secret** key, not the anon/publishable one.
- **Want to see raw data** — Supabase Dashboard → **Table Editor**.
