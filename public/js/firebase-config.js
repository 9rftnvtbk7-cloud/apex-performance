// ══════════════════════════════════════════════
// Firebase Configuration
// ══════════════════════════════════════════════
// INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project (or use existing)
// 3. Enable Authentication → Sign-in method → Google
// 4. Enable Firestore Database (Start in production mode)
// 5. Copy your config from Project Settings → General → Your apps → Web app
// 6. Paste the values below

const firebaseConfig = {
  apiKey: "AIzaSyBNsjldhFvvO_Pa1Cb6n2IvtqnCqWrYk3A",
  authDomain: "apex-performance-1fe0a.firebaseapp.com",
  projectId: "apex-performance-1fe0a",
  storageBucket: "apex-performance-1fe0a.firebasestorage.app",
  messagingSenderId: "389137780528",
  appId: "1:389137780528:web:48257a32076d0a57dd02f5"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// No offline persistence (enablePersistence): with multi-tab IndexedDB persistence,
// writes could stay queued forever in Safari (e.g. Strava tokens never reaching the
// server). Default in-memory cache + default network settings are reliable here.
