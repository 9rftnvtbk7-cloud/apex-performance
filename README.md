# Apex Performance Management

Personal fitness tracking app for triathlon training.

**Live**: https://apex-performance-1fe0a.web.app  
**Firebase Project**: apex-performance-1fe0a  
**Full documentation**: See `Apex_Handover_Memo.docx`

## Features

- **FIT File Parser** — Browser-based binary parser supporting all major devices
- **Strava Integration** — OAuth sync to import all activities automatically
- **Performance Management Chart** — CTL/ATL/TSB with forecast overlay
- **Period Comparison** — Compare metrics across weeks, months, or years
- **Training Plan** — Import JSON plans with ZWO workout files, auto-scrolls to current week
- **Training Planner** — 26-week planner with presets and projected PMC curve
- **Training Log** — Sortable, selectable table of all activities
- **Firebase Backend** — Google Auth, Firestore persistence, offline support

## Quick Deploy

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting

# For Cloud Functions (required for Strava):
cd functions && npm install && cd ..
firebase deploy --only functions

# For Firestore rules:
firebase deploy --only firestore:rules
```

## File Structure

```
public/index.html              # App shell (all 5 tabs)
public/css/styles.css          # Dark theme styles
public/js/app.js               # Core app logic
public/js/strava.js            # Strava OAuth + activity sync
public/js/database.js          # Firestore CRUD
public/js/auth.js              # Firebase Auth (Google Sign-In)
public/js/firebase-config.js   # Firebase credentials
public/js/fit-parser.js        # Binary FIT file parser
functions/index.js      # Cloud Functions (email ingestion + Strava token exchange)
functions/package.json  # Function dependencies
AppsScript.gs           # Gmail polling script
firebase.json           # Firebase config
firestore.rules         # Firestore security rules
```

## Setup Guides

- `DEPLOY_GUIDE.md` — Quick deploy cheat sheet
- `STRAVA_SETUP.md` — Strava API integration setup
- `SETUP_GUIDE.md` — Full project setup from scratch
