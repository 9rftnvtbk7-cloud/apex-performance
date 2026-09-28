// ══════════════════════════════════════════════
// Authentication Module
// ══════════════════════════════════════════════

let currentUser = null;
let hadSignedInUser = false;

function initAuth() {
  auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      document.getElementById('authSection').style.display = 'none';
      document.getElementById('appSection').style.display = 'block';
      document.getElementById('userAvatar').src = user.photoURL || '';
      document.getElementById('userAvatar').style.display = user.photoURL ? 'block' : 'none';
      document.getElementById('userName').textContent = user.displayName || user.email;
      loadUserData();
    } else {
      // Signed out (possibly from another tab): reload so no in-memory state
      // from the previous user (Strava tokens, plan, activities) survives
      if (hadSignedInUser) { location.reload(); return; }
      document.getElementById('authSection').style.display = 'flex';
      document.getElementById('appSection').style.display = 'none';
    }
    hadSignedInUser = !!user;
  });
}

async function signInWithGoogle() {
  try {
    await auth.signInWithPopup(googleProvider);
  } catch (err) {
    console.error('Sign-in error:', err);
    showToast('Sign-in failed: ' + err.message, '❌');
  }
}

async function signOut() {
  if (!confirm('Sign out?')) return;
  hadSignedInUser = false; // we reload ourselves below, after clearing the cache
  try {
    await auth.signOut();
  } catch (err) {
    console.error('Sign-out error:', err);
    return;
  }
  // Wipe the offline Firestore cache so the next user on this device can't read it
  try {
    await db.terminate();
    await db.clearPersistence();
  } catch (err) {
    console.warn('Could not clear Firestore cache (another tab may be open):', err);
  }
  sessionStorage.clear();
  location.reload();
}
