# Strava Integration — Setup Guide

One-time setup to connect Apex with the Strava API.

---

## Step 1: Create a Strava API Application

1. Go to **https://www.strava.com/settings/api**
2. Fill in the form:
   - **Application Name**: `Apex Performance`
   - **Category**: `Training`
   - **Club**: (leave blank)
   - **Website**: `https://apex-performance-1fe0a.web.app`
   - **Authorization Callback Domain**: `apex-performance-1fe0a.web.app`
   - **Description**: `Personal triathlon training tracker`
3. Click **Create**
4. You'll see your **Client ID** and **Client Secret** — keep this page open

---

## Step 2: Add credentials to your code

### 2A. Client-side (Client ID only)

Open `js/strava.js` and replace the placeholder:

```js
const STRAVA_CLIENT_ID = '12345';  // ← your Client ID (number)
```

### 2B. Server-side (Client Secret) — Cloudflare Worker

Strava requires the Client Secret to stay on a server. Apex uses a free Cloudflare Worker
(`worker/`) for this — no Firebase Blaze plan needed. One-time setup:

```bash
cd worker
npm install
npx wrangler login                          # free Cloudflare account, no card needed
npx wrangler secret put STRAVA_CLIENT_SECRET  # paste the secret when prompted
npx wrangler deploy                         # prints https://apex-strava.<you>.workers.dev
cd ..
```

The Client ID is not secret: it lives in `worker/wrangler.toml` (`STRAVA_CLIENT_ID`).
Never commit the Client Secret.

Then paste the Worker URL printed by `wrangler deploy` into `STRAVA_PROXY_URL` at the top of
`public/js/strava.js`.

---

## Step 3: Deploy and test

```bash
firebase deploy --only hosting
```

1. Open **https://apex-performance-1fe0a.web.app**
2. Sign in with Google
3. Click the **🔶 Connect Strava** button in the header
4. Authorize Apex on Strava's consent screen
5. You'll be redirected back — a toast will confirm the connection
6. Click **🔶 Sync Strava** to import your activities

---

## How it works

- **Connect**: OAuth2 flow — you authorize on Strava, they send a code back to Apex, which exchanges it for tokens via the Cloudflare Worker in `worker/` (so the Client Secret never touches the browser).
- **Sync**: Fetches your activities from the Strava API using the stored access token. Only imports activities newer than your latest existing activity (incremental sync).
- **Token refresh**: Access tokens expire after 6 hours. The app automatically refreshes them using the refresh token via the Cloudflare Worker.
- **Disconnect**: Removes stored tokens from Firestore. Already-imported activities remain.

---

## Strava API limits

- **100 requests per 15 minutes / 1000 per day** — each sync page is 1 request (100 activities per page), so a typical sync uses 1-5 requests.
- If you hit the rate limit, wait 15 minutes and try again.

---

## Troubleshooting

**"Strava proxy URL not configured"** — Set `STRAVA_PROXY_URL` in `public/js/strava.js` to your Worker URL and redeploy hosting.

**"Strava API credentials not configured on server"** — Run `npx wrangler secret put STRAVA_CLIENT_SECRET` in `worker/` (Step 2B).

**"Unauthorized" from the Worker** — Check `FIREBASE_PROJECT_ID` in `worker/wrangler.toml`, and that you are signed in to Apex.

**CORS error in the console** — Add your site's origin to `ALLOWED_ORIGINS` in `worker/wrangler.toml` and run `npx wrangler deploy`.

**"Token exchange failed"** — Check that your Authorization Callback Domain at strava.com/settings/api exactly matches `apex-performance-1fe0a.web.app` (no https://, no trailing slash).

**Activities not appearing** — Strava's API only returns activities you own. Private activities require the `activity:read_all` scope (which Apex requests by default).
