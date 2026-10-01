# CLAUDE.md — Apex Performance Management

## Project Overview

Triathlon fitness tracking web app. Users upload FIT files (or sync via Strava), and the app computes CTL/ATL/TSB (Performance Management Chart) metrics, lets them compare training periods, follow a structured training plan, and forecast future fitness.

**Live URL**: https://apex-performance-1fe0a.web.app
**Firebase Project**: `apex-performance-1fe0a`
**Owner**: Tristan Guilbot

## Tech Stack

- **Frontend**: Vanilla JS (no framework), single-page app with tab navigation
- **Charts**: Chart.js 4.4.1 (loaded from CDN)
- **Backend**: Firebase (Auth, Firestore, Hosting) on the free Spark plan — no Cloud Functions
- **Auth**: Firebase Authentication with Google Sign-In
- **Server-side**: one Cloudflare Worker (`worker/`, free tier) holding the Strava Client Secret
- **Strava**: OAuth integration for automatic activity sync

## File Structure

```
public/                    # Firebase Hosting root — ONLY this folder is served
  index.html               # App shell — 4 tabs: Today (#tab-overview), Plan (Week · Month calendar #planCalendarPanel · List #planListPanel), Season (Forecast #tab-planner · Compare #tab-compare · Insights #tab-insights), Activities (#tab-log)
  css/styles.css           # Graphite design system (dark) + Daylight (light) tokens and components
  js/theme.js              # CSS tokens → Chart.js: C() palette, chartTooltip/chartScaleX/chartScaleY, rebuild on theme change
  js/app.js                # Core app logic — charts, comparison, plan, planner
  js/auth.js               # Firebase Auth with Google Sign-In
  js/database.js           # Firestore CRUD operations
  js/firebase-config.js    # Firebase project credentials (public by design)
  js/fit-parser.js         # Binary FIT protocol parser (ArrayBuffer/DataView)
  js/strava.js             # Strava OAuth + activity sync
  js/plan-import.js        # Training plan parsing/validation (normalizePlan) — see schema below
  js/thresholds.js         # Dated threshold history (FTP/LTHR/paces) — thresholdsAt(date)
  js/metrics.js            # Pure stream analytics: histograms, mean-max curves (power, speed, HR), decoupling, eFTP, zones; STREAM_STATS_VERSION 2 (needsStreamStats)
  js/insights.js           # Season › Insights: training status, race readiness, running-load guard, intensity (zones, 80/20, easy-session HR caps), eFTP/eLTHR, aerobic efficiency, new bests, best efforts — pure calc functions + render*
  js/activity-detail.js    # Activity dialog: map (Leaflet), stream charts, laps, notes/RPE/feel
  js/workout-export.js     # Plan steps → .zwo / .fit workout (FIT validated with Garmin's SDK)
  js/race-target.js        # Season › Forecast race-day CTL/TSB solver
  js/calendar.js           # Plan tab views (setPlanView): Week/Month calendar, compliance colours, move sessions (plan/overrides)
  js/wellness.js           # Wellness log + readiness rules
  sw.js, manifest.webmanifest, icons/   # Installable app (PWA); sw: own files network-first
worker/src/index.js        # Cloudflare Worker: Strava token exchange/refresh, verifies Firebase ID tokens
worker/test/index.test.js  # Worker tests — `cd worker && npm test`
worker/wrangler.toml       # Worker config (Client ID, project ID, allowed origins; no secrets)
firebase.json              # Hosting (no-cache, security headers), firestore rules
firestore.rules            # User-scoped security rules
training-plan/             # Sample training plan data (JSON + ZWO files)
test-fixtures/             # Plan import fixtures (short/long/detailed/broken) + import diagnosis
tests/app.test.mjs         # App logic tests (node --test tests/)
```

## Architecture

### Data Flow
1. User uploads `.fit` files → `fit-parser.js` parses binary → activity saved to Firestore
2. OR Strava OAuth sync → `strava.js` fetches activities → saved to Firestore
4. `database.js` loads all activities → `app.js` computes PMC metrics → Chart.js renders

### Firestore Collections (all under `/users/{userId}/`)
- `activities/{id}` — Individual workout data (date, sport, duration, TSS, power, HR, etc.)
- `settings/{docId}` — User settings (FTP, threshold pace, etc.)
- `planner/{docId}` — 26-week planner grid data
- `plan/{docId}` — `current` (+ `current_part_N` when > 800 KB), `completions`, `overrides` (moved sessions), `raceDates`, `zwo_files`
- `settings/thresholds` — `{ history: [{ from, ftp, lthr, pace, swimPace }] }`; `settings/strava` — tokens
- `wellness/{YYYY-MM-DD}` — daily resting HR, HRV, sleep, soreness, stress, weight, notes
- Activities from Strava carry `stravaId`, `name`, `polyline`, `elevationGain`, `streamStats` (histograms + curves, not raw streams), and journal fields `notes`, `rpe`, `feel`

### Key Concepts
- **TSS (Training Stress Score)**: Calculated per activity. Bike: NP/power > HR; run: HR > pace (pace ignores climbing); swim: CSS pace; strength (`isStrength`): time only, 50/h; else HR > duration fallback. Calendar compliance: ≥ 80 % of planned TSS = done (over is fine), strength sessions compare time with `durationMin`
- **CTL (Chronic Training Load)**: 42-day exponential moving average of TSS = "fitness"
- **ATL (Acute Training Load)**: 7-day exponential moving average of TSS = "fatigue"
- **TSB (Training Stress Balance)**: CTL - ATL = "form"
- **PMC (Performance Management Chart)**: Plots CTL, ATL, TSB, and daily TSS over time
- **Thresholds are dated**: always score with `thresholdsAt(activity.startDate)`, never with the current inputs
- **Stream stats** store HR/power histograms so zones can be recomputed for any threshold without refetching; the background fetch (`backfillStreams`) respects Strava's 100 req / 15 min limit
- **Auto-sync** runs on open / focus / every 15 min, only after `activitiesLoaded` (dedupe needs the list)
- **Device sync**: on returning to the foreground (`refreshSharedData`) the app reloads itself if a newer `?v=` was deployed, else re-reads plan, ticks, moved sessions, races and planner weeks. Settings › Sync shows account, plan saved time, races and app version to compare devices
- **Compare** (`comparePeriods`): presets with equal-length periods (4 weeks, month to date, year to date, 12 weeks vs a year ago, custom), sport chips, cumulative day-by-day chart; Trend card per week/month
- **Today's forecast** (`forecastFromSeasonPlan`) follows the weekly TSS of Season › Forecast up to a week past the next race; the flat "average daily TSS" only fills unplanned days
- **Ramp rate**: CTL change over the last 7 days (>8/week = too fast). **TSB zones**: `tsbZone()` in `app.js`
- **Plan vs actual**: `matchPlanToActivities()` ticks plan sessions matched to an activity on the same day with a compatible sport; plan week dates get their year from the plan's `race_date` (`planWeekStart()`)
- **Activities come from Strava** for the owner; `.FIT` upload is secondary (account menu → Upload .FIT files)

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
for f in public/js/*.js worker/src/index.js; do node --check "$f"; done
node --test tests/          # app logic: TSS, Strava sync, planner, deletes
(cd worker && npm test)
```
A stray brace or syntax error will silently break the entire app with no console output.

## Deployment

### Prerequisites
- Firebase CLI: `npm install -g firebase-tools`
- Authenticated: `firebase login` (or `firebase login:ci --no-localhost` in Codespaces)

### Deploy Commands
```bash
# Hosting + rules (the project is on Spark: never deploy functions)
firebase deploy --only hosting,firestore:rules

# Hosting only (HTML/JS/CSS changes)
firebase deploy --only hosting

# Strava token proxy (Cloudflare Worker)
cd worker && npx wrangler deploy

# Firestore rules only
firebase deploy --only firestore:rules
```

### Deploy Checklist
1. Run `node --check` on all JS files
2. Update `?v=` cache-bust timestamps in `index.html` script tags
3. Deploy with appropriate scope
4. Test in an incognito/private window to verify cache-busted assets load

## Known Issues and Gotchas

1. **Hosting serves only `public/`**: never put docs, logs, worker code or secrets in `public/` — everything in it is downloadable from the live site.
2. **Compare charts clipping**: Bottom of comparison charts can clip if container height is too small. `.compare-chart-wrap` uses `min-height: 300px` with padding.
3. **Push permissions**: In the local Claude Code CLI, `git push` uses the owner's own GitHub credentials but needs the owner's approval (the repo is public); the owner runs pushes and deploys themselves unless they allow it. Claude Code on the web would need the Claude GitHub App installed on the `9rftnvtbk7-cloud` account.
4. **Do not re-enable Firestore offline persistence** (`db.enablePersistence({ synchronizeTabs: true })`): in Safari it left writes queued forever (Strava tokens were exchanged but never saved, so "Connect Strava" appeared to do nothing). The app uses Firestore's default in-memory cache.
5. **Free plan only**: the owner does not want to pay for Firebase Blaze. Anything needing a server goes in the Cloudflare Worker, not Cloud Functions.

## Development Workflow

1. Make changes to files in `public/` (`js/`, `css/`, `index.html`)
2. Validate: `for f in public/js/*.js; do node --check "$f"; done`
3. Test locally: `firebase serve --only hosting` (requires Firebase CLI)
4. Deploy: `firebase deploy --only hosting`

## Training plan import schema

Import via Plan tab → "Import Plan JSON". `normalizePlan()` in `js/plan-import.js` validates the file; errors
name the week/session and are shown in the Plan tab, and nothing is imported. Generate new plans in this format
(reference example: `test-fixtures/plan_detailed.json`).

```jsonc
{                                   // may also be wrapped as {"trainingPlan": { ... }}
  "name": "Saint-Nolff Trail 30K",  // optional — shown as the plan title (fallback: race)
  "version": "v2.1",                // optional — badge next to the title (also plan_version)
  "race": "Trail de Saint-Nolff",   // optional
  "raceDate": "2026-11-15",         // optional — ISO date (or text like "First weekend of May 2026"); sets the plan year
  "startDate": "2026-09-07",        // optional — Monday of week 1, used when week dates can't be read
  "ftpWatts": 200, "generated": "2026-09-28", "athlete": "…",   // optional
  "weeks": [                        // REQUIRED, non-empty
    {
      "week": 1,                    // optional (defaults to position)
      "phase": "BASE",              // optional
      "dates": "7 – 13 sept.",      // optional — English or French ("Feb 23 – Mar 1", "28 sept. – 4 oct.")
      "startDate": "2026-09-07",    // optional — wins over "dates"
      "color": "#2E7D32", "note": "…",                              // optional
      "tss": 0, "sessionCount": 0,  // ignored — recomputed from the sessions
      "sessions": [                 // REQUIRED (may be empty)
        {
          "day": "Tuesday",         // REQUIRED — Monday…Sunday (or lundi…dimanche)
          "sport": "bike",          // REQUIRED — bike | run | swim | strength | strength+swim | rest | race
          "name": "W01 Tue – Tempo",// recommended
          "description": "…",       // optional — short summary on the card (≤200 chars; longer is clamped)
          "tss": 55,                // optional, default 0
          "id": "W01_Tue_Bike",     // optional — generated as w{week}-{n}-{day}; keep stable to keep ticks
          "completed": false,       // optional
          "zwoFile": null,          // optional (also zwo_file)
          "details": "## Warm-up\n- 10min Z1→Z2…",  // optional — Markdown: #, -/*/1. lists, >, **b**, *i*, `code`
          "durationMin": 50,        // optional
          "hrTarget": "≤135 bpm", "powerTarget": "170W (85% FTP)",    // optional text
          "steps": [ { "label": "3×8min", "duration": "8min", "target": "170W", "rest": "2min Z1" } ]  // optional
        }
      ]
    }
  ]
}
```

Storage: the normalised plan is one JSON string in `plan/current`; above 800 KB it is split into
`plan/current_part_N` documents (see `saveTrainingPlan`). Ticks live in `plan/completions`, keyed by session id.

## Security Rules

- **Secrets never go in git.** `STRAVA_CLIENT_SECRET` is a Cloudflare Worker secret (`npx wrangler secret put STRAVA_CLIENT_SECRET`). Only non-secret values go in `worker/wrangler.toml`.
- **Never interpolate data into HTML unescaped.** Use `escapeHtml()` for every value inserted via `innerHTML`/template strings (including attributes), `safeColor()` for colours in `style`, and pass strings to inline handlers via `data-*` attributes, not `onclick="fn('${value}')"`.
- **Worker endpoints must verify the Firebase ID token** (`verifyFirebaseIdToken` in `worker/src/index.js`); the client sends it via `callAuthedFunction()` in `strava.js`.
- **Dates:** use `localDateKey()` / `addDays()` from `app.js` — never `toISOString().slice(0, 10)` for calendar days (it is UTC and shifts days in Europe).

## Coding Conventions

- Vanilla JavaScript — no build step, no bundler, no framework
- Functions use camelCase, with descriptive names (`buildPMCChart`, `renderComparison`)
- CSS uses BEM-like class naming (`.plan-week-card`, `.compare-chart-wrap`)
- Design: "Graphite" (dark, default) and "Daylight" (light, via `prefers-color-scheme` or `<html data-theme>`), specified in `design_handoff_apex_redesign/README.md`. All colours are tokens in `:root` of `styles.css` (`--bg-*`, `--text-*`, `--color-ctl/atl/tsb/tss`, `--color-ok/partial/missed`, `--sport-*`); never hard-code hex in markup or charts
- Charts read colours through `C()` and share `chartTooltip()`, `chartScaleX()`, `chartScaleY()` from `theme.js` — no per-chart tooltip/grid colours. Data semantics: fitness blue, fatigue pink, form green, TSS amber
- No emoji in the UI (line icons from the SVG sprite in `index.html`); `showToast(msg, '✅'|'⚠️'|'❌')` uses the emoji only as a kind code
- Layout: sidebar ≥ 1024 px, bottom tab bar below; Activities shows a list below 900 px and the table from 900 px (both rendered by `renderTrainingTable`)
- Dialogs (`#settingsDialog`, `#activityDialog`, `#sessionDialog`) are native `<dialog class="sheet">`
- Interactive elements are real `<button>`s (never clickable `div`s) so keyboard and screen readers work
- All Firestore operations go through `js/database.js` — never call Firestore directly from `app.js`
- Chart instances stored in module-level variables (`pmcChart`, `compareChart`, `plannerChart`) and destroyed before recreation to prevent memory leaks
