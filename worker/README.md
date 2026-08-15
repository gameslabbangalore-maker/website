# Games Lab ticketing API

In-house ticketing for gameslab.co.in. The website collects the guest's details
and quantity; Razorpay is used only for the final payment.

Runs on Cloudflare Workers (JavaScript, not Node) with Cloudflare D1 (SQLite).
Jekyll never sees this directory — it is in the `exclude:` list in `_config.yml`.

---

## The one rule

**The browser is never believed about money or entitlement.**

- Charge amounts are computed in SQL from `occurrences.price_paise`. The client
  cannot submit an amount, and one would be ignored.
- A booking becomes `paid` **only** via a signature-verified Razorpay webhook.
  Checkout's browser-side success callback is a UX hint, nothing more.

If you change one thing in this codebase, do not change those two.

---

## Architecture

```
Google Calendar (ICS)
   │  cron, every 6h
   ▼
occurrences ──┐
              │  GET /api/availability      → homepage "N seats left"
              │  GET /api/occurrences/:id   → /book/ page
              ▼
         POST /api/book
              │  1. atomic seat hold (single INSERT…SELECT…WHERE)
              │  2. Razorpay Orders API  → order_id
              ▼
   Razorpay Standard Checkout (modal on our own /book/ page)
              │
              ▼
   POST /api/razorpay/webhook  (HMAC-SHA256 verified)
              │  → booking = paid, mint one ticket row per seat, email
              ▼
   /ticket/?b=…&t=…   polls until paid, then shows a QR per ticket
              │        (QR images come from GET /api/qr)
              ▼
```

Staff-facing, both behind `ADMIN_TOKEN`:

```
GET /api/admin/occurrences  → every upcoming date with capacity/sold/held/left
GET /api/admin/attendees    → who booked a given date
```

Both back the `/admin/` page on the site, which is where "how many tickets are
left?" gets answered without opening the database.

### Why seat holds are one SQL statement

`createHold()` in `src/db.js` does the availability check and the insert in a
single `INSERT … SELECT … WHERE` so SQLite makes it atomic. Splitting it into a
`SELECT` then an `INSERT` would let two concurrent buyers both pass the check and
oversell the room. Availability is
`capacity − paid − unexpired_pending_holds`.

Holds last `HOLD_MINUTES` (default 10) and are released by the 5-minute cron.

---

## First-time setup

### Node 22 is required

Wrangler 4 declares `engines: node >=22`. Anything older fails immediately with
*"Wrangler requires at least Node.js v22.0.0"*. There is a `.nvmrc` here, so:

```bash
cd worker
nvm use          # reads .nvmrc -> Node 22
node -v          # must print v22.x
```

**Run this in every terminal tab that touches wrangler.** nvm is per-shell, so a
new tab silently reverts to your default Node — which on this machine is v16.20.2
(EOL). That mismatch is the cause of most "it worked in the other tab" confusion.

```bash
npm install

# 1. Create the database, then paste the returned id into wrangler.toml
npx wrangler d1 create gameslab-ticketing

# 2. Create the tables
npm run migrate:remote

# 3. Seed the six event templates
npm run seed:remote
```

### Secrets

Never put these in `wrangler.toml`.

```bash
npx wrangler secret put RAZORPAY_KEY_ID          # start with rzp_test_…
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET  # invent one, paste the same into Razorpay
npx wrangler secret put ADMIN_TOKEN              # openssl rand -hex 24
npx wrangler secret put RESEND_API_KEY           # without it NO ticket email is sent
```

Without `RESEND_API_KEY` the buyer gets only Razorpay's payment receipt — never
a Games Lab ticket. `/api/health` shows `email_configured: false` when that is
the case, and the Worker logs `email=skipped:no-key` for each paid booking.
Set the secret and verify the sending domain in Resend before selling tickets.

### Deploy

```bash
npm run deploy
curl https://<your-worker>/api/health
```

`/api/health` reports which secrets are wired up without revealing them.

### Razorpay dashboard

1. **Settings → Webhooks → Add New Webhook**
   - URL: `https://<your-worker>/api/razorpay/webhook`
   - Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured`, `payment.failed`, `order.paid`,
     `refund.processed`
2. Stay in **Test mode** until you have completed the smoke test below.

### Turn it on in the site

In `_config.yml`:

```yaml
ticketing:
  enabled: true
  api_base: "https://<your-worker>"
```

Until `enabled` is `true`, the site keeps using each event's `ticket_link`
(the existing `rzp.io` pages), so this whole system can be deployed and tested
before any customer sees it.

---

## Setting prices

Prices live on the **occurrence**, so every date is independent. There are two
ways to set one, and the first covers the normal case.

### 1. In git — `_events/*.md` front matter (preferred)

```yaml
title: "Night of Mafias !"
slug: night-of-mafias
price: 350
capacity: 25
```

Commit and push. The `sync-event-defaults` workflow fires on any change under
`_events/**`, POSTs to `/api/admin/event-defaults`, and the Worker:

1. updates `events.default_price_paise` / `default_capacity` for that slug, and
2. opens **every future occurrence that was never priced** — i.e. still
   `status = 'draft'` with `price_paise = 0`.

So a new date appearing in Google Calendar becomes sellable on its own, with the
price already in git. `price: 0` is the safe default: the sitting stays `draft`
and cannot be sold.

Run it by hand, or preview without touching anything:

```bash
node scripts/sync-event-defaults.mjs --dry-run

TICKETING_API_BASE=https://gameslab-ticketing.gameslab-events.workers.dev \
TICKETING_ADMIN_TOKEN=<admin token> \
  node scripts/sync-event-defaults.mjs
```

Required repository secrets (Settings → Secrets and variables → Actions):
`TICKETING_API_BASE`, `TICKETING_ADMIN_TOKEN`.

**A date that already has a price keeps it.** Raising `price` in front matter
does not reprice sittings that are already open — otherwise a push could silently
change what a date already advertises to buyers. To reprice an open date, edit it
directly:

```bash
npx wrangler d1 execute gameslab-ticketing --remote \
  --command "UPDATE occurrences SET price_paise = 40000 WHERE id = 'night-of-mafias-20261002'"
```

### 2. In Google Calendar — per-date override

Only needed when one date differs from the event's usual price. Put these lines
anywhere in that calendar entry's description:

```
price: 450
capacity: 16
```

Also accepted: `price: ₹450`, `price: 45000 paise`, `seats: 16`, and
`tickets: closed` to hold a date back. Surrounding prose is ignored. Calendar
directives are re-applied on every sync, so they win over the git default.

---

## Testing

### Level 1 — offline, no setup (seconds)

```bash
cd worker && npm test
```

- `test:signature` proves the webhook HMAC check accepts real Razorpay
  signatures and rejects tampered bodies, wrong secrets, truncated signatures,
  and re-serialised JSON. Runs the actual `src/razorpay.js` code.
- `test:hold` runs the real `createHold` SQL against in-memory SQLite and proves
  capacity cannot be exceeded, expired holds release seats, and closed / unpriced
  / past sittings refuse bookings.

`test:hold` is Python because it tests *SQL semantics*, and Python's stdlib
ships SQLite — no install, and no dependency added to a JS project.

### Level 2 — local, whole flow (~15 min)

You need **three** terminal tabs. Two run servers and stay open (they never
return to a prompt); the third is where you actually type commands.

#### Step 0 — local secrets, FIRST

Create `worker/.dev.vars` (gitignored, never committed) **before** starting
`wrangler dev`:

```
SITE_ORIGIN=http://localhost:4000,https://gameslab.co.in
ADMIN_TOKEN=localtoken
RAZORPAY_WEBHOOK_SECRET=whsec_local
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxx
```

> `SITE_ORIGIN` is not optional locally. It overrides the production value in
> `wrangler.toml`, and without `http://localhost:4000` in the list the API
> returns `200` but with `Access-Control-Allow-Origin: https://gameslab.co.in`,
> so the browser discards every response and `/book/` shows "Something went
> wrong" with nothing useful in the network tab. **`curl` does not enforce CORS**,
> so every command-line test still passes — which makes this failure mode very
> easy to misdiagnose. Check for it with:
>
> ```bash
> curl -sD - -o /dev/null -H "Origin: http://localhost:4000" \
>   http://localhost:8787/api/availability | grep -i access-control-allow-origin
> ```
>
> It must echo `http://localhost:4000`, not the production domain.

> **`wrangler dev` reads `.dev.vars` only at startup.** It hot-reloads source
> changes but not this file, so if you create or edit it while `dev` is running,
> every `/api/admin/*` call returns `{"error":"unauthorized"}`
> however correct your token is. Restart `wrangler dev` after touching it.

Sanity-check before going further:

```bash
curl -s http://localhost:8787/api/health
```

`admin_configured` must be `true`. If it is `false`, the secrets did not load —
restart `wrangler dev`. Only the two `RAZORPAY_KEY_*` values may stay as
placeholders for now; they are needed only when you submit the `/book/` form.

#### Terminal 1 — the Worker (leave running)

Create the local tables **before** starting the server, or every request dies
with `D1_ERROR: no such table: events`:

```bash
cd ~/Desktop/website/worker
nvm use                              # Node 22 — required
npm install
npm run migrate:local                # creates the tables
npm run seed:local                   # inserts the 6 event templates
npx wrangler dev                     # serves http://localhost:8787
```

Verify the tables exist before moving on:

```bash
npx wrangler d1 execute gameslab-ticketing --local --command "SELECT slug FROM events"
```

#### Terminal 2 — the site (leave running)

First set this temporarily in `_config.yml`:

```yaml
ticketing:
  enabled: true
  api_base: "http://localhost:8787"
```

```bash
cd ~/Desktop/website
bundle exec jekyll serve             # serves http://localhost:4000
```

> Jekyll does not reload `_config.yml` — restart `jekyll serve` after editing it.
> Revert both values before committing.

#### Terminal 3 — where you run everything below

```bash
cd ~/Desktop/website/worker
nvm use                              # Node 22 — required in this tab too
```

Both lines matter. `wrangler` finds its database through `wrangler.toml`, so a
`wrangler` command run from another directory fails; and without `nvm use` this
tab uses your default Node 16 and wrangler refuses to start. The `curl` commands
are plain HTTP — they work from anywhere, on any Node.

```bash
# 1. Populate occurrences from the real Google Calendar
curl -X POST -H "Authorization: Bearer localtoken" http://localhost:8787/api/admin/sync

# 2. See what got created, and grab a real occurrence id
npx wrangler d1 execute gameslab-ticketing --local \
  --command "SELECT id, starts_at_utc, price_paise, capacity, status FROM occurrences ORDER BY starts_at_utc"

# 3. Price one sitting so it becomes sellable (use an id from step 2)
npx wrangler d1 execute gameslab-ticketing --local \
  --command "UPDATE occurrences SET price_paise=35000, capacity=20, status='open' WHERE id='night-of-mafias-20260807'"

# 4. Confirm it is on sale
curl http://localhost:8787/api/availability
```

Do not copy the id in step 3 literally — `night-of-mafias-20260807` is an
example. Use whatever step 2 actually printed, or nothing will be on sale.

> If a `d1 execute --local` write doesn't seem to show up in the running Worker,
> restart `wrangler dev` in Terminal 1. Both use the same SQLite file under
> `worker/.wrangler/state/`, but `dev` can hold a cached connection.

**Prefer no SQL at all.** Setting the price through Google Calendar is the
intended workflow — add `price: 350` and `capacity: 20` to the calendar event's
description, then re-run step 1. That is exactly what you'll do in production,
so testing it this way tests the real path.

Now open `http://localhost:4000/book/?o=<id-from-step-2>`, fill the form, and pay
with a Razorpay **test** card (`4111 1111 1111 1111`, any future expiry, any CVV)
or test UPI `success@razorpay`.

**The bit that catches everyone:** Razorpay cannot reach `localhost`, so the
webhook never arrives and `/ticket/` stays on "Confirming…" forever. That is
correct behaviour, not a bug — a booking is only paid once a *verified* webhook
lands. Simulate it — again in **Terminal 3**, from `worker/`:

```bash
# Find the order id your booking created
npx wrangler d1 execute gameslab-ticketing --local \
  --command "SELECT id, razorpay_order_id, status FROM bookings ORDER BY created_at DESC LIMIT 3"

# Fire a properly signed webhook (paste the razorpay_order_id from above)
node test/sign-webhook.mjs --order=order_XXXX --secret=whsec_local --send
```

`/ticket/` should flip to CONFIRMED with ticket codes within a couple of seconds.

Other paths worth exercising the same way:

```bash
node test/sign-webhook.mjs --order=order_XXXX --secret=whsec_local --event=payment.failed --send
node test/sign-webhook.mjs --order=order_XXXX --secret=wrong --send    # must 401
```


### Level 3 — deployed, Razorpay test mode

Deploy with test keys and a real webhook pointed at the Worker, then run the
smoke test below. This is the first point at which real webhooks arrive, so it is
the only place CSP and webhook delivery can genuinely be validated.

```bash
npx wrangler tail    # watch live logs while you click through
```

---

## Smoke test before going live

Do all of this in Razorpay **Test mode**.

1. `curl https://<worker>/api/health` — all four flags `true`.
2. `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker>/api/admin/sync`
   — check `report.upserted` is non-zero and `report.unmatched` is empty. Any
   name in `unmatched` means a calendar title didn't map to an event slug.
3. `curl https://<worker>/api/availability` — your next sitting appears with a
   sane `available` and `on_sale: true`.
4. Open `/book/?e=night-of-mafias`, fill the form, pay with a Razorpay test card.
5. Confirm `/ticket/` flips from "Confirming…" to codes within a few seconds. If
   it sits on "Confirming", the webhook is not arriving — check
   `npx wrangler tail` and the Razorpay webhook delivery log.
6. **Verify the CSP.** Open devtools on `/book/` during a real test payment and
   watch for CSP violations. Razorpay's checkout pulls from several hosts and
   that list changes; the ones in `_includes/head.html` are current as of this
   build but must be confirmed against an actual payment, not assumed.
7. Try to oversell: set `capacity = 1`, then start two bookings in two browsers.
   The second must get `409 insufficient_seats`.
9. Forge a webhook: `curl -X POST https://<worker>/api/razorpay/webhook -d '{}'`
   must return `401 invalid_signature`.

Only after all nine pass, switch the Razorpay keys to live and set
`ticketing.enabled: true`.

---

## Going live on workers.dev (Option A)

The site stays on GitHub Pages exactly as it is. The Worker deploys separately to
its free `workers.dev` subdomain, and the browser calls it cross-origin — which is
why `SITE_ORIGIN` already lists both `gameslab.co.in` and `www.gameslab.co.in`.
`git push` still deploys the site; `wrangler deploy` deploys the API. Two
independent things.

Run these in order. Steps 1-3 need an interactive browser.

```bash
cd worker && nvm use

# 1. Cloudflare account + auth (opens a browser)
npx wrangler login

# 2. Create the production database, then paste the printed id
#    over REPLACE_WITH_D1_DATABASE_ID in wrangler.toml
npx wrangler d1 create gameslab-ticketing

# 3. Create the tables and seed the six event templates
npm run migrate:remote
npm run seed:remote

# 4. Secrets. Keep using rzp_test_ keys for the first deploy.
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET   # invent one; paste the same into Razorpay
npx wrangler secret put ADMIN_TOKEN               # openssl rand -hex 24

# 5. Deploy. Note the https://gameslab-ticketing.<subdomain>.workers.dev URL it prints.
npm run deploy

# 6. Confirm
curl -s https://gameslab-ticketing.<subdomain>.workers.dev/api/health
```

`/api/health` must show `admin_configured: true`, `webhook_configured: true`, and
`razorpay_mode: "test"`. If `razorpay_mode` says `live` at this stage, stop — you
have production keys in and would take real money during testing.

### Razorpay webhook

Dashboard (still in **Test mode**) → Settings → Webhooks → Add:

- URL: `https://gameslab-ticketing.<subdomain>.workers.dev/api/razorpay/webhook`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`

### Populate and price

```bash
export API=https://gameslab-ticketing.<subdomain>.workers.dev
export TOKEN=<your ADMIN_TOKEN>

curl -X POST -H "Authorization: Bearer $TOKEN" $API/api/admin/sync
curl -s $API/api/availability
```

Everything arrives as `draft` with `price_paise: 0` and is not sellable. Set a
price by adding `price: 350` and `capacity: 20` to the event's description in
Google Calendar, then re-run the sync.

### Point the site at it

In `_config.yml`:

```yaml
ticketing:
  enabled: true
  api_base: "https://gameslab-ticketing.<subdomain>.workers.dev"
```

Commit and push. GitHub Pages rebuilds and booking is live. Until `enabled` is
`true`, every Book Now still uses each event's `ticket_link`, so pushing the code
ahead of this change is safe.

Then work the nine-step smoke test above against the deployed URL — this is the
first point where **real** webhooks arrive, so it is the only place webhook
delivery and CSP can genuinely be validated.

### Switching to live money

Only after the smoke test passes: re-run the two `RAZORPAY_KEY_*` secret commands
with `rzp_live_` keys, add a second webhook in Razorpay's Live mode pointing at
the same URL, redeploy, and confirm `/api/health` reports
`razorpay_mode: "live"`. Watch `npx wrangler tail` during the first real booking.

---

## Operations

```bash
# Live logs
npx wrangler tail

# Attendee list for a date
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<worker>/api/admin/attendees?occurrence=night-of-mafias-20260807"

# Force a calendar sync
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker>/api/admin/sync

# Ad-hoc SQL
npx wrangler d1 execute gameslab-ticketing --remote \
  --command "SELECT id, starts_at_utc, price_paise, capacity, status FROM occurrences ORDER BY starts_at_utc"
```

### Occurrence ids are deterministic

`<event-slug>-<YYYYMMDD>` in Asia/Kolkata, e.g. `murder-mystery-20260807`. This
is why the static site can build a `/book/` link straight from `calendar.json`
without an API call. The rule is implemented twice — `occurrenceId()` in
`src/ids.js` and the derivation in `_includes/scripts-event-core.html` — and the
two must stay in step.

Consequence: two sittings of the same event on the same local day would collide.
The sync reports these in `report.collisions` rather than silently dropping one.
If that becomes a real pattern, add a time suffix to the id on both sides.

### Statuses

| Table | Status | Meaning |
|---|---|---|
| occurrences | `draft` | synced, no price yet — not sellable |
| | `open` | on sale |
| | `closed` | sales stopped by hand, or the event end time has passed |
| | `cancelled` | called off |
| | `hidden` | retained in D1 but omitted from the Ticket Desk |
| bookings | `pending` | seats held, awaiting payment |
| | `paid` | webhook verified, tickets minted |
| | `failed` | payment failed or order creation failed |
| | `expired` | hold lapsed unpaid, seats released |
| | `refunded` | refunded at Razorpay |

Google Calendar's `DTEND` is stored as `occurrences.ends_at_utc`. The start time
is still the public schedule time; the end time is internal and is the hard
booking cutoff used by both the Worker and the static site.

### Deploy from GitHub

The manual **Deploy ticketing Worker** workflow runs tests, applies pending D1
migrations, deploys the Worker, and immediately syncs Calendar end times.
Configure repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`TICKETING_API_BASE`, and `TICKETING_ADMIN_TOKEN`, then run the workflow from
the Actions tab. Keep it manual so production changes remain deliberate.

### Known trade-offs

- **A payment landing after its hold expires is honoured, not refused.** The
  money is already taken. Such bookings get a `notes` flag reading
  `paid after hold expiry - verify capacity` — worth grepping before a full
  event. `/api/admin/attendees` surfaces `notes`.
- **A booking can go `failed` -> `paid`.** Razorpay keeps an order open across
  retries, so a buyer whose first attempt fails can succeed on a second attempt
  against the *same* order. `payment.failed` therefore marks a booking `failed`
  but that state is **not terminal**: `markPaidAndMintTickets` accepts a
  transition from `pending`, `failed`, or `expired`. Only `paid` and `refunded`
  are terminal. Getting this wrong means taking money and minting no ticket —
  see the `paid-transition` block in `test/seat-hold.test.py`.
- **The webhook returns 200 even on internal errors** (after logging), because
  Razorpay retries non-2xx forever and one poison event would otherwise be
  redelivered indefinitely. Check `webhook_log.outcome` for recorded failures.
- **Venue list is duplicated.** `VENUES` in `src/calendar-sync.js` mirrors
  `_data/locations.yml`; add new venues to both.
- **Rescheduling in Google Calendar creates a new occurrence** rather than moving
  the old one, because the occurrence id encodes the date. The old row lingers.
  That is deliberate: if it already has paid bookings, moving them is a human
  decision (transfer or refund), not something a sync should do silently. Close
  the stale row by hand:
  `UPDATE occurrences SET status='cancelled' WHERE id='<old-id>'`.
- **No `form-action` in the CSP.** It was tried and removed: Razorpay's
  top-level redirect flows (UPI intent, some netbanking) can submit a form from
  the page context, and getting that directive wrong breaks a payment method
  silently. Worth adding back only after confirming every method works with it.

---

## Still to do

- **Policy pages.** Razorpay requires publicly reachable Terms & Conditions,
  Privacy Policy, and Refund/Cancellation Policy to fully activate an account,
  and audits for them. The site has none, and the footer links none. This is the
  most likely thing to delay a launch — write these early.
- Admin UI for editing capacity/price (SQL works meanwhile).
- QR codes on tickets. Codes are typed today, which is genuinely fine at
  12-25 guests; adding QR means vendoring an encoder, since `script-src 'self'`
  rules out a CDN.
- GA4 `begin_checkout` / `purchase` events. The site has no analytics at all
  right now, so the booking funnel is unmeasurable.
- Waitlist when sold out, promo codes, group discounts.
