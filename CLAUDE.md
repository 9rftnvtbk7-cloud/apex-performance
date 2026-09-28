# CLAUDE.md — Apex Performance Management

## Project Overview

Triathlon fitness tracking web app. Users upload FIT files (or sync via Strava), and the app computes CTL/ATL/TSB (Performance Management Chart) metrics, lets them compare training periods, follow a structured training plan, and forecast future fitness.

**Live URL**: https://apex-performance-1fe0a.web.app
**Firebase Project**: `apex-performance-1fe0a`
**Owner**: Tristan Guilbot

## Tech Stack

- **Frontend**: Vanilla JS (no framework), single-page app with tab navigation
- **Charts**: Chart.js 4.4.1 (loaded from CDN)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions v2, Hosting)
- **Auth**: Firebase Authentication with Google Sign-In
- **Cloud Functions**: Node.js 22, Firebase Functions v2 SDK
- **Email ingestion**: Google Apps Script polls Gmail → Cloud Function → Firestore
- **Strava**: OAuth integration for automatic activity sync

## File Structure

```
public/                    # Firebase Hosting root — ONLY this folder is served
  index.html               # App shell — all 5 tabs (Overview, Compare, Plan, Planner, Log)
  css/styles.css           # Dark-theme styles
  js/app.js                # Core app logic — charts, comparison, plan, planner
  js/auth.js               # Firebase Auth with Google Sign-In
  js/database.js           # Firestore CRUD operations
  js/firebase-config.js    # Firebase project credentials (public by design)
  js/fit-parser.js         # Binary FIT protocol parser (ArrayBuffer/DataView)
  js/strava.js             # Strava OAuth + activity sync
functions/index.js         # Cloud Functions: email ingestion + Strava token exchange
functions/package.json     # Node 22, firebase-admin, firebase-functions v7, busboy
AppsScript.gs              # Gmail polling script (runs every 5 min)
firebase.json              # Hosting (no-cache), functions, firestore rules
firestore.rules            # User-scoped security rules
training-plan/             # Sample training plan data (JSON + ZWO files)
```

## Architecture

### Data Flow
1. User uploads `.fit` files → `fit-parser.js` parses binary → activity saved to Firestore
2. OR Strava OAuth sync → `strava.js` fetches activities → saved to Firestore
3. OR Email pipeline: Gmail → Apps Script → Cloud Function → `pending_fits` collection → client processes on login
4. `database.js` loads all activities → `app.js` computes PMC metrics → Chart.js renders

### Firestore Collections (all under `/users/{userId}/`)
- `activities/{id}` — Individual workout data (date, sport, duration, TSS, power, HR, etc.)
- `settings/{docId}` — User settings (FTP, threshold pace, etc.)
- `planner/{docId}` — 26-week planner grid data
- `plan/{docId}` — Imported training plan JSON + ZWO files
- `pending_fits/{docId}` — FIT files received via email, awaiting client processing

### Key Concepts
- **TSS (Training Stress Score)**: Calculated per activity. Priority: NP-based > power-based > pace-based > HR-based > duration fallback
- **CTL (Chronic Training Load)**: 42-day exponential moving average of TSS = "fitness"
- **ATL (Acute Training Load)**: 7-day exponential moving average of TSS = "fatigue"
- **TSB (Training Stress Balance)**: CTL - ATL = "form"
- **PMC (Performance Management Chart)**: Plots CTL, ATL, TSB, and daily TSS over time

## Critical Development Rules

### Chart.js 4 on Category Axes
**Chart.js 4 does NOT support `min`/`max` options on category (string) axes.** When filtering by date range, you MUST slice the data arrays (labels, ctlData, atlData, tsbData, tssData) before passing them to the chart. Never use `options.scales.x.min/max` — it silently fails and shows an empty chart.

### Safari Compatibility
- **File inputs**: Do NOT use hidden `<input type="file">` elements. Create them dynamically with `document.createElement('input')` and trigger `.click()` immediately. Hidden inputs inside `display:none` tabs do not fire `onchange` in Safari.
- **Month pickers**: `<input type="month">` does not work on Safari. Use `<select>` dropdowns populated with month options instead.

### Variable Declarations
Always declare state variables at the top of `app.js`. An undeclared variable (like a missing `let currentRange`) causes a `ReferenceError` that silently kills all subsequent function registrations in the script — nothing works and there is no visible error in the UI.

### Firebase Caching
- `firebase.json` sets `Cache-Control: no-cache, max-age=0` for JS/CSS files
- Script tags in `index.html` use `?v=timestamp` cache busters
- After deploying, always update the `?v=` timestamps to force browsers to fetch new versions

### Syntax Validation
Always validate JavaScript before deploying:
```bash
for f in public/js/*.js functions/index.js; do node --check "$f"; done
```
A stray brace or syntax error will silently break the entire app with no console output.

## Deployment

### Prerequisites
- Firebase CLI: `npm install -g firebase-tools`
- Authenticated: `firebase login` (or `firebase login:ci --no-localhost` in Codespaces)

### Deploy Commands
```bash
# Full deploy (hosting + functions + rules)
firebase deploy

# Hosting only (HTML/JS/CSS changes)
firebase deploy --only hosting

# Cloud Functions only
cd functions && npm install && cd ..
firebase deploy --only functions

# Firestore rules only
firebase deploy --only firestore:rules
```

### Deploy Checklist
1. Run `node --check` on all JS files
2. Update `?v=` cache-bust timestamps in `index.html` script tags
3. Deploy with appropriate scope
4. Test in an incognito/private window to verify cache-busted assets load

## Known Issues and Gotchas

1. **Hosting serves only `public/`**: never put docs, logs, functions code or secrets in `public/` — everything in it is downloadable from the live site.
2. **Compare charts clipping**: Bottom of comparison charts can clip if container height is too small. `.compare-chart-wrap` uses `min-height: 300px` with padding.
3. **Cloud Functions push permissions**: Pushing to GitHub from Claude Code is currently blocked (GitHub App not installed for this org). Deploy must be done manually or via GitHub Codespaces.
4. **Apps Script setup**: The Gmail polling script (`AppsScript.gs`) must be deployed separately in Google Apps Script console and requires a time-based trigger (every 5 minutes).

## Development Workflow

1. Make changes to files in `public/` (`js/`, `css/`, `index.html`)
2. Validate: `for f in public/js/*.js; do node --check "$f"; done`
3. Test locally: `firebase serve --only hosting` (requires Firebase CLI)
4. Deploy: `firebase deploy --only hosting`

## Security Rules

- **Secrets never go in git.** `STRAVA_CLIENT_SECRET` and `APEX_API_KEY` live in Secret Manager (`firebase functions:secrets:set <NAME>`) and are read with `defineSecret`. Only non-secret values (`STRAVA_CLIENT_ID`) go in `functions/.env`, which is git-ignored.
- **Never interpolate data into HTML unescaped.** Use `escapeHtml()` for every value inserted via `innerHTML`/template strings (including attributes), `safeColor()` for colours in `style`, and pass strings to inline handlers via `data-*` attributes, not `onclick="fn('${value}')"`.
- **Browser-called Cloud Functions must verify the Firebase ID token** (`requireFirebaseUser`); the client sends it via `callAuthedFunction()` in `strava.js`.
- **Dates:** use `localDateKey()` / `addDays()` from `app.js` — never `toISOString().slice(0, 10)` for calendar days (it is UTC and shifts days in Europe).

## Coding Conventions

- Vanilla JavaScript — no build step, no bundler, no framework
- Functions use camelCase, with descriptive names (`buildPMCChart`, `renderComparison`)
- CSS uses BEM-like class naming (`.plan-week-card`, `.compare-chart-wrap`)
- Dark theme throughout — background `#1a1a2e`, accent `#e94560`
- All Firestore operations go through `js/database.js` — never call Firestore directly from `app.js`
- Chart instances stored in module-level variables (`pmcChart`, `compareChart`, `plannerChart`) and destroyed before recreation to prevent memory leaks
