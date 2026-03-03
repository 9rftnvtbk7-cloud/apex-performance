# Apex — Performance Management

A web-based fitness tracking and performance management app for endurance athletes. Upload .FIT files from Garmin, Wahoo, Strava, Apple Health, and more to track your CTL (Fitness), ATL (Fatigue), and TSB (Form).

## Features

- **FIT File Parser** — Browser-based binary parser supporting all major devices
- **Performance Management Chart** — CTL/ATL/TSB with forecast overlay
- **Period Comparison** — Compare metrics (TSS, time, distance, IF, HR) across weeks, months, or years
- **Training Planner** — 26-week planner with presets (maintain, build, taper, polarized) and projected PMC curve
- **Training Log** — Sortable table of all activities
- **Firebase Backend** — Google Auth, Firestore persistence, offline support
- **Sport Detection** — Auto-detects 50+ sport types from FIT protocol
- **TSS Calculation** — Power-based, pace-based, and HR-based methods

## Tech Stack

- Vanilla HTML/CSS/JS (no build tools required)
- Chart.js 4 for data visualization
- Firebase Auth (Google sign-in)
- Firebase Firestore (activity storage)
- Firebase Hosting (deployment)

---

## Setup Guide

### 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `apex-performance`)
3. Disable Google Analytics (optional) → **Create project**

### 2. Enable Authentication

1. In Firebase Console → **Authentication** → **Sign-in method**
2. Enable **Google** provider
3. Set your support email
4. Save

### 3. Create Firestore Database

1. **Firestore Database** → **Create database**
2. Choose **Start in production mode**
3. Select a region close to you (e.g. `europe-west1`)
4. Click **Create**

### 4. Register a Web App

1. **Project Settings** (gear icon) → **General** → **Your apps**
2. Click the web icon (`</>`) to add a web app
3. Name it `apex-web`
4. Check **Also set up Firebase Hosting**
5. Copy the `firebaseConfig` object

### 5. Configure the App

Edit `public/js/firebase-config.js` and paste your config:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "apex-performance.firebaseapp.com",
  projectId: "apex-performance",
  storageBucket: "apex-performance.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

### 6. Install Firebase Tools & Deploy

```bash
npm install -g firebase-tools
firebase login
firebase use --add    # select your project

# Deploy everything (hosting + rules)
firebase deploy

# Or just hosting
firebase deploy --only hosting
```

### 7. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit — Apex Performance Management"
git remote add origin https://github.com/YOUR_USERNAME/apex-performance.git
git push -u origin main
```

---

## Project Structure

```
apex-app/
├── public/                  # Deployed to Firebase Hosting
│   ├── index.html           # Main app shell
│   ├── css/
│   │   └── styles.css       # All styles
│   └── js/
│       ├── firebase-config.js   # ← YOUR Firebase config here
│       ├── auth.js              # Google Auth module
│       ├── database.js          # Firestore CRUD
│       ├── fit-parser.js        # Binary FIT file parser
│       └── app.js               # Main app logic
├── firebase.json            # Hosting + Firestore config
├── firestore.rules          # Security rules
├── firestore.indexes.json   # Query indexes
├── storage.rules            # Storage rules (for future FIT file storage)
├── .firebaserc              # Project alias
├── .gitignore
├── package.json
└── README.md
```

---

## Firestore Data Model

```
users/
  {userId}/
    settings/
      athlete          → { ftp, lthr, thresholdPace }
    activities/
      {activityId}     → { sport, startDate, duration, distance,
                            avgHr, maxHr, avgPower, np, avgSpeed,
                            calories, tss, intensityFactor, fileName }
    planner/
      weeks            → { weeks: [{ weekStart, tss }] }
```

---

## Email-to-FIT Ingestion

To receive FIT files via email, you would need a server-side component. Here's the architecture:

### Option A: SendGrid Inbound Parse (Recommended)

1. **Setup a receive domain** (e.g. `upload@fit.yourdomain.com`)
2. **Configure SendGrid Inbound Parse** to forward emails to a webhook
3. **Deploy a Cloud Function** that:
   - Receives the parsed email with attachment
   - Validates the sender (matches a registered user email)
   - Extracts the .FIT attachment
   - Parses it server-side using the same FIT parser logic (ported to Node.js)
   - Saves the activity to the user's Firestore collection

```
Email → SendGrid → Cloud Function → Parse FIT → Save to Firestore
                                                       ↓
                                              User sees it in app
```

### Option B: Mailgun Routes

Same concept, different email provider. Mailgun has built-in routing that can POST attachments to a webhook URL.

### Option C: Google Apps Script + Gmail

1. Set up a dedicated Gmail account (e.g. `apex.upload@gmail.com`)
2. Create a Google Apps Script that runs on a timer (every 5 min)
3. Script checks for new emails with .FIT attachments
4. Extracts attachment, calls a Cloud Function to process it

### Implementation Steps (for Option A)

```bash
# In the functions/ directory:
cd functions
npm init
npm install firebase-admin @sendgrid/inbound-mail-parser

# Deploy:
firebase deploy --only functions
```

The Cloud Function would look roughly like:

```javascript
exports.inboundEmail = functions.https.onRequest(async (req, res) => {
  const email = parseSendGridPayload(req.body);
  const senderEmail = email.from;

  // Find user by email
  const user = await admin.auth().getUserByEmail(senderEmail);
  if (!user) return res.status(403).send('Unknown sender');

  // Extract FIT attachment
  const fitAttachment = email.attachments.find(a => a.filename.endsWith('.fit'));
  if (!fitAttachment) return res.status(400).send('No FIT file');

  // Parse FIT file
  const activity = parseFitFile(fitAttachment.content);
  const tss = computeTSS(activity, userSettings);

  // Save to Firestore
  await admin.firestore()
    .collection('users').doc(user.uid)
    .collection('activities').add({ ...activity, tss });

  res.status(200).send('OK');
});
```

### Cost Estimate

- **SendGrid**: Free tier = 100 emails/day (more than enough)
- **Cloud Functions**: Free tier = 2M invocations/month
- **Firestore**: Free tier = 50K reads, 20K writes/day
- **Total**: Free for personal use

---

## Local Development

```bash
# Serve locally
firebase serve --only hosting

# Or use any static server
cd public && python3 -m http.server 8080
```

Note: Firebase Auth requires the app to be served from an authorized domain. Add `localhost` to **Authentication → Settings → Authorized domains** for local testing.

---

## License

MIT
