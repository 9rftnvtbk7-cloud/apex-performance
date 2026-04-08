# Apex — Full Deployment Guide (Mac)

This guide takes you from zero to deployed. Follow each section in order.

---

## Part 1: Install the tools

Open **Terminal** (press Cmd+Space, type "Terminal", hit Enter).

### 1A. Install Homebrew (Mac package manager)

If you've never installed Homebrew, paste this and hit Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It will ask for your Mac password (you won't see characters as you type — that's normal). Follow any "Next steps" it prints at the end.

To check it worked:

```bash
brew --version
```

### 1B. Install Node.js

```bash
brew install node
```

Verify:

```bash
node --version
npm --version
```

You should see version numbers (Node 20+ is ideal).

### 1C. Install Git

Git usually comes with macOS, but to make sure:

```bash
git --version
```

If it prompts you to install Xcode Command Line Tools, click **Install** and wait.

### 1D. Install Firebase CLI

```bash
npm install -g firebase-tools
```

Verify:

```bash
firebase --version
```

---

## Part 2: Set up GitHub

### 2A. Create a GitHub account (skip if you have one)

Go to https://github.com and sign up.

### 2B. Create a new repository

1. Go to https://github.com/new
2. Repository name: `apex-performance`
3. Set it to **Private** (your Firebase config is in here)
4. Do NOT check "Add a README" (you already have one)
5. Click **Create repository**
6. Keep this page open — you'll need the URL it shows

### 2C. Connect your local folder to GitHub

In Terminal, navigate to your project folder. Replace the path below with wherever your apex-performance-full folder is:

```bash
cd ~/path/to/apex-performance-full
```

If you're not sure where it is, you can drag the folder from Finder into Terminal after typing `cd ` (with a space).

Now run these commands one by one:

```bash
# Initialize git in this folder
git init

# Add all your files
git add .

# Create your first commit
git commit -m "Initial commit: Apex Performance Management app"

# Connect to your GitHub repo (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/apex-performance.git

# Push to GitHub
git branch -M main
git push -u origin main
```

It will ask for your GitHub username and password. **Important**: GitHub no longer accepts passwords — you need a Personal Access Token instead:

1. Go to https://github.com/settings/tokens?type=beta
2. Click **Generate new token**
3. Name it "Apex deploy"
4. Under Repository access, select **Only select repositories** → choose `apex-performance`
5. Under Permissions → Repository permissions → set **Contents** to "Read and write"
6. Click **Generate token**
7. **Copy the token immediately** (you won't see it again)
8. Use this token as your "password" when Terminal asks

After this, `git push` should succeed and you'll see your code at `https://github.com/YOUR_USERNAME/apex-performance`.

---

## Part 3: Set up Firebase

### 3A. Log in to Firebase

```bash
firebase login
```

This opens a browser window. Sign in with the **same Google account** you use for the Firebase console (the one that owns the `apex-performance-1fe0a` project).

Verify you're connected:

```bash
firebase projects:list
```

You should see `apex-performance-1fe0a` in the list.

### 3B. Make sure you're in the project folder

```bash
cd ~/path/to/apex-performance-full
```

The `.firebaserc` file already points to the right project, so Firebase knows which project to deploy to.

### 3C. Deploy the frontend

```bash
firebase deploy --only hosting
```

That's it! Within 30 seconds, your updated app will be live at:

**https://apex-performance-1fe0a.web.app**

---

## Part 4: Future updates (the routine)

After making changes, here's the 4-command routine:

```bash
# 1. Check what changed
git status

# 2. Stage the changed files
git add index.html css/styles.css js/app.js

# 3. Commit to GitHub
git commit -m "Description of what you changed"

# 4. Push to GitHub
git push

# 5. Deploy to Firebase
firebase deploy --only hosting
```

---

## Quick reference

| What | Command |
|---|---|
| Deploy frontend | `firebase deploy --only hosting` |
| Deploy Firestore rules | `firebase deploy --only firestore:rules` |
| Deploy Cloud Functions | `cd functions && npm install && cd .. && firebase deploy --only functions` |
| Deploy everything | `firebase deploy` |
| Test locally | `firebase serve --only hosting` (opens at localhost:5000) |
| Push code to GitHub | `git add . && git commit -m "message" && git push` |
| Check deploy status | `firebase hosting:channel:list` |

---

## Troubleshooting

**"command not found: firebase"** — Run `npm install -g firebase-tools` again, then restart Terminal.

**"permission denied"** — Add `sudo` before the command (e.g., `sudo npm install -g firebase-tools`).

**"not a firebase project"** — Make sure you're in the right folder. Run `cat .firebaserc` and you should see `apex-performance-1fe0a`.

**"authentication error" on git push** — Your token may have expired. Generate a new one at https://github.com/settings/tokens?type=beta

**Firebase shows old version** — Hard-refresh the browser with Cmd+Shift+R. Firebase caching headers are set to no-cache, but your browser may still hold a stale copy.
