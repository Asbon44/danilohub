# DataHub — Mobile Data Bundle Store

Everything is now in **one site** you upload as a single unit:

- **Root** — the public-facing pages customers use: `index.html` (Homepage,
  network tabs, bundles, buy modal, Paystack checkout) and `orders.html`
  (My Orders lookup).
- **admin/** — the private admin panel, living inside the same site:
  `admin/login.html` and `admin/dashboard.html` (Orders table, Order
  details, Mark as Sent, Manage Bundles).

The footer of every customer-facing page has an **"Admin Portal"** link
that opens `admin/login.html`. It's a plain text link at the bottom of the
page — deliberately low-key, since customers don't need it, but it's one
tap away for you.

**Admin login:**
```
Username: Danilo
Password: Datahub
```
(This is a simple client-side check in `admin/js/admin.js` — see the
security note below before you launch for real.)

Upload the whole folder to wherever you like (Netlify, Vercel, GitHub
Pages, cPanel, Firebase Hosting, etc.) — it just needs to reach your
Firebase Realtime Database, which it does over plain REST calls (no SDK/API
key required).

## ⚠️ Important — read before you launch

**1. Never put your Paystack SECRET key in these files.**
Only the **public** key (`pk_test_...`) is used in `client/js/app.js`, and
that's correct — Paystack's inline checkout is designed to run in the
browser with the public key. The **secret** key
(`sk_test_ae38810e7e493db67befa1682cd00c68853a39d8`) you shared must **never**
be placed in any HTML/JS file, because anyone who views your site's source
could read it and use it to access your Paystack account. It has **not**
been included anywhere in these files.

The secret key is only needed if you want to *verify* a payment from a
server (calling `GET https://api.paystack.co/transaction/verify/:reference`).
That requires a real backend (e.g. a small Node/Express server, or a
Firebase Cloud Function) — something outside plain HTML/CSS/JS. Right now
this build trusts the `callback` from Paystack's inline widget on the
customer's device, which is fine for a test-mode demo but **should be
upgraded to server-side verification before you take real payments**, since
a malicious user could in theory fake a "successful" callback in their
browser without actually paying.

**2. Firebase Realtime Database rules.**
The site talks to Firebase using plain `fetch()` calls to its REST API, so
no SDK or API key is required — just the database URL, which is already
set in `client/js/firebase-config.js` and `admin/js/firebase-config.js`:

```
https://ghana-ambulance-60a8d-default-rtdb.firebaseio.com
```

For this to work, open your Firebase console → Realtime Database → Rules,
and set (for testing only):

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

This lets the site read/write orders and bundle pricing. It is **open to
anyone** with your database URL, which is fine for testing but not for a
real launch — before going live, add real Firebase Authentication and
rules that restrict writes to your admin account and reads to each
customer's own orders.

**3. Admin login is a simple hardcoded check (not real security).**
`admin/js/admin.js` currently checks the username/password against two
constants at the top of the file:

```js
const ADMIN_USERNAME = "Danilo";
const ADMIN_PASSWORD = "Datahub";
```

**Change these before you deploy.** This is a client-side check only —
adequate for a demo, but anyone who reads the JavaScript file can see the
password. For a real launch, replace this with Firebase Authentication
(email/password sign-in) so credentials are never shipped in the code.

## How data flows (local-first, Firebase as the pipe)

Orders are always saved **on the device that created or is viewing them
first** — Firebase is only used to carry a copy between the customer's
device and the admin portal. This means a customer's paid order is never
lost even if Firebase is briefly unreachable, and the admin dashboard
still works from its own local copy if Firebase drops.

1. A customer pays through Paystack (mobile money or card, test mode).
2. On success, the order is saved **immediately in that browser's local
   storage** — this always succeeds, so the customer sees "Payment
   Successful" and the order in `orders.html` right away, with zero
   dependency on Firebase at that moment.
3. In the background, the same order is sent to Firebase at
   `orders/<auto-id>` so the admin portal receives it. If that send fails
   (e.g. rules not set yet, no connection), it's queued and retried
   automatically the next time the page loads — nothing is lost, it just
   arrives late.
4. `admin/dashboard.html` polls Firebase every few seconds and merges
   whatever it gets into its **own local cache** (`localStorage` on the
   admin's browser). If Firebase is briefly unreachable, the dashboard
   keeps showing that local cache instead of an error.
5. When the admin clicks **Mark as Sent**, the local cache updates
   instantly (so the dashboard always feels responsive), and the change is
   pushed to Firebase in the background — queued and retried if it fails.
6. `orders.html` re-checks Firebase for status updates (like "Sent") and
   quietly updates the local copy when it can reach it; it always shows
   the local copy regardless.
7. Bundle prices live in Firebase at `bundles/...`, edited from the
   admin's **Manage Bundles** screen; the client reads them live and falls
   back to sensible defaults the first time it runs (see `js/data.js`).

**In short:** local storage on each device is the record of truth for that
device; Firebase's only job is to relay orders and status changes between
customer devices and the admin portal.

## Troubleshooting: "The customer got a success message, but I don't see the order in the admin dashboard"

With the local-first flow above, a customer's payment always shows as
successful and saves on their device — so this symptom specifically means
the order hasn't made the trip from their device to Firebase (and
therefore to your dashboard) yet. Check these, in order of likelihood:

1. **You created a Firestore database, not a Realtime Database.** These
   are two different products in Firebase and it's an easy mix-up. Go to
   your Firebase console → Build → **Realtime Database** (not "Firestore
   Database") and check a database actually exists there, with a URL
   matching `ghana-ambulance-60a8d-default-rtdb.firebaseio.com`. If you
   only see Firestore, click **Create Database** under Realtime Database.
2. **Rules are blocking reads/writes.** Every new Realtime Database
   defaults to `".read": false, ".write": false` until you change it. Go
   to Realtime Database → **Rules** and set (for testing only):
   ```json
   { "rules": { ".read": true, ".write": true } }
   ```
   then click **Publish**.
3. **It just hasn't synced yet.** On the customer's `orders.html`, look at
   the status column — a small "· syncing…" note means it's still queued
   on their device and will send automatically next time that page loads
   (or the next time they're back online). Once rules/setup are fixed,
   refreshing `orders.html` on their device will push it through.
4. **Wrong project/database URL.** Double-check the URL in
   `js/firebase-config.js` (and `admin/js/firebase-config.js`) matches the
   URL shown at the top of your Realtime Database page in the console
   exactly, including `https://` and no trailing slash.

Once the rules/setup are correct, both sides recover on their own — the
customer's device retries queued orders on its next page load, and the
admin dashboard retries any queued "Mark as Sent" updates the next time it
polls. Nothing needs to be manually re-entered.

## Troubleshooting: nothing happens at all when a customer clicks "Pay Now"

1. **Open the browser console** (F12 → Console tab) right when they click
   "Pay Now". Any red error is the real cause — copy it, it'll point
   straight at the problem.
2. **Paystack blocked from loading.** Ad blockers or strict browser
   privacy modes sometimes block `js.paystack.co`. The site checks for
   this and shows a message under the form instead of doing nothing — if
   you see that message, whitelist the site or try a different browser.
3. **The payment popup was closed before finishing.** An order is only
   created after Paystack calls back with a successful payment. Closing
   the popup partway through (common while testing) intentionally does
   not create an order.

## Testing payments

Use Paystack's test cards / test mobile money numbers (see Paystack's docs)
— your Paystack account is in test mode, so no real money moves.

## Folder map

```
index.html          Homepage — network tabs, bundles, buy modal, checkout
orders.html          My Orders — customer order lookup
css/style.css
js/firebase-config.js
js/data.js            Default bundle prices + Firebase loader
js/app.js             Bundle rendering, purchase modal, Paystack, save order
js/orders.js           My Orders lookup logic

admin/
  login.html           Admin login (footer "Admin Portal" link opens this)
  dashboard.html       Orders table, stats, order details, mark as sent, bundles
  css/admin-style.css
  js/firebase-config.js
  js/admin.js           Auth gate, orders CRUD, bundle pricing CRUD
```
