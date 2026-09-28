# Apex Performance Management — Setup Guide for Cowork

## Prerequisites

Before starting, you need:

1. **GitHub access** — Ask Tristan to add you as a collaborator on the `apex-performance` repo
2. **Firebase Console access** — Ask Tristan to add your Google email as **Editor** at:
   `https://console.firebase.google.com/project/apex-performance-1fe0a/settings/iam`
3. **Node.js 20+** installed (or use GitHub Codespaces which has it)

## Quick Start with GitHub Codespaces (Recommended)

1. Go to the GitHub repo → click **Code** → **Codespaces** → **Create codespace**
2. In the terminal:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login:ci --no-localhost
# Follow the URL, authorize, paste the code back

# Deploy frontend
firebase deploy --only hosting

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy the Strava token proxy (Cloudflare Worker) — see STRAVA_SETUP.md
cd worker && npm install && npx wrangler deploy && cd ..
```

## Local Development

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/apex-performance.git
cd apex-performance

# Install Firebase CLI
npm install -g firebase-tools
firebase login

# Serve locally
firebase serve --only hosting
# Opens at http://localhost:5000

# Deploy
firebase deploy --only hosting
```

## Project Structure

```
├── public/                     # Everything served by Firebase Hosting
│   ├── index.html              # Main app shell (all 5 tabs)
│   ├── css/styles.css          # Complete dark theme
│   └── js/
│   ├── app.js                  # Core logic (~1160 lines) - PMC, charts, comparison, planner, plan
│   ├── database.js             # Firestore CRUD operations
│   ├── auth.js                 # Firebase Auth (Google Sign-In)
│   ├── firebase-config.js      # Firebase project credentials (DO NOT commit to public repos)
│   └── fit-parser.js           # Binary FIT protocol parser
├── worker/                     # Cloudflare Worker: Strava token exchange/refresh
│   ├── src/index.js            # Holds the Strava Client Secret, verifies Firebase ID tokens
│   ├── test/index.test.js      # npm test
│   └── wrangler.toml           # Worker config (no secrets)
├── training-plan/              # Sample training plan data for testing
│   ├── training_plan_v5.json   # 10-week Olympic triathlon plan
│   └── W01-W10/                # 47 ZWO workout files
├── firebase.json               # Firebase hosting config
├── firestore.rules             # Firestore security rules
├── firestore.indexes.json      # Firestore query indexes
├── storage.rules               # Firebase Storage rules
├── .firebaserc                 # Firebase project alias
├── Apex_Handover_Memo.docx     # Full technical documentation
└── README.md
```

## Firebase Configuration

| Setting          | Value                                    |
|-----------------|------------------------------------------|
| Project ID      | `apex-performance-1fe0a`                 |
| Hosting URL     | https://apex-performance-1fe0a.web.app   |
| Firestore       | europe-west1                             |
| Strava proxy    | Cloudflare Worker (`worker/`)            |
| Auth            | Google Sign-In                           |
| Plan            | Spark (free) — no Cloud Functions        |

## Key Files to Understand

### js/app.js (~1160 lines)
The main application logic. Contains:
- PMC calculation (CTL/ATL/TSB)
- Chart.js chart building with custom plugins (race markers)
- Comparison mode logic (date range, year vs year, month vs month, running totals)
- Training plan import/render with ZWO file management
- 26-week planner with presets and race date markers
- FIT file handling with progress bar
- Activity selection and bulk delete

### js/database.js (~256 lines)
All Firestore operations. Every function is a standalone async function:
- `loadUserData()` / `saveActivity()` / `deleteActivity()`
- `saveSettings()` / `savePlannerData()`
- `saveTrainingPlan()` / `loadTrainingPlan()`
- `saveZwoFiles()` / `loadZwoFiles()`
- `savePlanCompletions()` / `loadPlanCompletions()`
- `saveRaceDatesData()` / `loadRaceDatesData()`
- `updateActivitiesTss()`

### js/fit-parser.js (~200 lines)
Binary FIT protocol parser. Reads ArrayBuffer from .FIT files and extracts:
sport, startDate, duration, distance, avgHr, maxHr, avgPower, normalizedPower, avgSpeed, calories

## Common Development Tasks

### Adding a new Firestore collection
1. Add read/write functions in `database.js`
2. Add security rule in `firestore.rules`
3. Deploy rules: `firebase deploy --only firestore:rules`

### Adding a new tab
1. Add nav button in `index.html` (inside `.nav-tabs`)
2. Add tab content div (inside `dashboardSection`)
3. Add render logic in `app.js`
4. Add `switchTab` case if needed

### Modifying charts
- All charts use Chart.js 4.4.1
- Category axes: slice data arrays, don't use min/max
- Custom plugins go in chart config `plugins: [myPlugin]`, not globally
- Race date markers use `afterDraw` plugin hook

### Testing the Plan tab
1. Open the app → Plan tab → Import Plan JSON
2. Select `training-plan/training_plan_v5.json`
3. Click Import ZWO Files → select all files from `training-plan/W*/`
4. Sessions should show with download buttons

## Known Gotchas

1. **Safari file inputs**: Hidden inputs don't fire `onchange`. Always use `document.createElement('input')` dynamically.
2. **Chart.js category axis**: `min`/`max` options don't work. Slice the data arrays before creating the chart.
3. **Firebase cache**: JS/CSS cached aggressively. `firebase.json` sets `no-cache`, and script tags have `?v=timestamp`.
4. **No Cloud Functions**: the project is on the free Spark plan. Server-side code lives in the Cloudflare Worker (`worker/`).
5. **Firestore 1MB limit**: Plan/ZWO data stored as stringified JSON in single docs. May need splitting for large plans.
6. **Global variables**: If a `let` declaration is missing, the entire script after that point fails silently. Always run `node --check app.js` before deploying.

## Contact

For questions about the app's history and design decisions, refer to the Handover Memo or ask Tristan.
