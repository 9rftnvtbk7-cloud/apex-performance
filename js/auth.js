// ══════════════════════════════════════════════
// Authentication Module
// ══════════════════════════════════════════════

let currentUser = null;

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
      document.getElementById('authSection').style.display = 'flex';
      document.getElementById('appSection').style.display = 'none';
      allActivities = [];
      plannerInited = false;
    }
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
  try {
    await auth.signOut();
    allActivities = [];
    pmcResult = {};
    plannerInited = false;
    if (pmcChart) { pmcChart.destroy(); pmcChart = null; }
    if (compareChart) { compareChart.destroy(); compareChart = null; }
    if (plannerChart) { plannerChart.destroy(); plannerChart = null; }
  } catch (err) {
    console.error('Sign-out error:', err);
  }
}
