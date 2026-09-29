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
      const name = user.displayName || user.email || '';
      document.getElementById('userName').textContent = name;
      // Initials avatar (header on phones, sidebar on desktop) unless there is a profile photo
      const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
      for (const id of ['headerInitials', 'sidebarInitials']) { const el = document.getElementById(id); if (el) el.textContent = initials; }
      const hi = document.getElementById('headerInitials'); if (hi) hi.style.display = user.photoURL ? 'none' : '';
      const sn = document.getElementById('sidebarUserName'); if (sn) sn.textContent = name;
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
    // Installed app (standalone) or blocked popup: fall back to a full-page redirect
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(err.code)) {
      try { await auth.signInWithRedirect(googleProvider); return; } catch (e) { err = e; }
    }
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
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
