# Apex — Deploy Cheat Sheet

Quick reference for deploying updates. Assumes Git, Node, and Firebase CLI are already installed and authenticated.

---

## Deploy routine

Open **Terminal**, then:

```bash
# Navigate to your project folder
cd ~/path/to/apex-performance-full

# 1. Check what files changed
git status

# 2. Stage the changed files
git add index.html css/styles.css js/app.js firebase.json

# 3. Commit with a message describing the change
git commit -m "Your description here"

# 4. Push to GitHub
git push

# 5. Deploy to Firebase
firebase deploy --only hosting
```

Your site updates at **https://apex-performance-1fe0a.web.app** within ~30 seconds.

---

## This time — what to deploy

The files changed in this update:

```bash
git add index.html css/styles.css js/app.js firebase.json DEPLOY_GUIDE.md
git commit -m "UI improvements: fix stat grid, mobile responsive, tab transitions, week summary, better empty state"
git push
firebase deploy --only hosting
```

---

## Other deploy commands

| What | Command |
|---|---|
| Frontend only | `firebase deploy --only hosting` |
| Firestore rules | `firebase deploy --only firestore:rules` |
| Cloud Functions | `cd functions && npm install && cd .. && firebase deploy --only functions` |
| Everything at once | `firebase deploy` |
| Test locally first | `firebase serve --only hosting` (opens at localhost:5000) |

---

## Troubleshooting

- **Old version still showing?** Hard-refresh with **Cmd + Shift + R**
- **"not a firebase project"?** Make sure you're in the right folder — run `cat .firebaserc` to check
- **Git push rejected?** Run `git pull` first, then push again
