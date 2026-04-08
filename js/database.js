// ══════════════════════════════════════════════
// Database Module (Firestore)
// ══════════════════════════════════════════════

// ── Load all user data on sign-in ──
async function loadUserData() {
  if (!currentUser) return;
  const uid = currentUser.uid;

  showToast('Loading your data…', '⏳');

  try {
    // Load settings
    const settingsDoc = await db.collection('users').doc(uid).collection('settings').doc('athlete').get();
    if (settingsDoc.exists) {
      const s = settingsDoc.data();
      if (s.ftp) document.getElementById('inputFtp').value = s.ftp;
      if (s.lthr) document.getElementById('inputLthr').value = s.lthr;
      if (s.thresholdPace) document.getElementById('inputPace').value = s.thresholdPace;
    }

    // Load activities
    const snap = await db.collection('users').doc(uid).collection('activities')
      .orderBy('startDate', 'desc').get();

    allActivities = [];
    snap.forEach(doc => {
      const d = doc.data();
      allActivities.push({
        id: doc.id,
        sport: d.sport || 'other',
        startDate: d.startDate?.toDate ? d.startDate.toDate() : new Date(d.startDate),
        duration: d.duration || 0,
        distance: d.distance || 0,
        avgHr: d.avgHr || null,
        maxHr: d.maxHr || null,
        avgPower: d.avgPower || null,
        np: d.np || null,
        avgSpeed: d.avgSpeed || 0,
        calories: d.calories || null,
        tss: d.tss || 0,
        intensityFactor: d.intensityFactor || null,
        fileName: d.fileName || '',
        powerSamples: [], // Not stored in Firestore (too large)
        hrSamples: [],
      });
    });

    // Load planner
    const plannerDoc = await db.collection('users').doc(uid).collection('planner').doc('weeks').get();
    if (plannerDoc.exists) {
      const pd = plannerDoc.data();
      if (pd.weeks && Array.isArray(pd.weeks)) {
        savedPlannerWeeks = pd.weeks;
      }
    }

    log(`[DB] Loaded ${allActivities.length} activities`, 'ok');
    showToast(`Loaded ${allActivities.length} activities`, '✅');
    refreshDashboard();

  } catch (err) {
    console.error('Load error:', err);
    showToast('Error loading data', '❌');
  }
}

// ── Save activity to Firestore ──
async function saveActivity(activity) {
  if (!currentUser) return null;
  const uid = currentUser.uid;

  const docData = {
    sport: activity.sport,
    startDate: firebase.firestore.Timestamp.fromDate(activity.startDate),
    duration: activity.duration,
    distance: activity.distance,
    avgHr: activity.avgHr || null,
    maxHr: activity.maxHr || null,
    avgPower: activity.avgPower || null,
    np: activity.np || null,
    avgSpeed: activity.avgSpeed || 0,
    calories: activity.calories || null,
    tss: activity.tss || 0,
    intensityFactor: activity.intensityFactor || null,
    fileName: activity.fileName || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    const ref = await db.collection('users').doc(uid).collection('activities').add(docData);
    return ref.id;
  } catch (err) {
    console.error('Save error:', err);
    showToast('Error saving activity', '❌');
    return null;
  }
}

// ── Delete activity ──
async function deleteActivity(activityId) {
  if (!currentUser || !activityId) return;
  try {
    await db.collection('users').doc(currentUser.uid).collection('activities').doc(activityId).delete();
  } catch (err) {
    console.error('Delete error:', err);
  }
}

// ── Save athlete settings ──
async function saveSettings() {
  if (!currentUser) return;
  const uid = currentUser.uid;
  try {
    await db.collection('users').doc(uid).collection('settings').doc('athlete').set({
      ftp: +document.getElementById('inputFtp').value || 200,
      lthr: +document.getElementById('inputLthr').value || 165,
      thresholdPace: document.getElementById('inputPace').value || '5:00',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('Settings save error:', err);
  }
}

// ── Save planner data ──
async function savePlannerData() {
  if (!currentUser) return;
  const uid = currentUser.uid;
  try {
    const weeks = plannerData.map(p => ({
      weekStart: p.weekStart.toISOString(),
      tss: p.tss,
    }));
    await db.collection('users').doc(uid).collection('planner').doc('weeks').set({
      weeks,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Planner save error:', err);
  }
}

// ── Delete all activities ──
async function deleteAllActivities() {
  if (!currentUser) return;
  const uid = currentUser.uid;
  try {
    const snap = await db.collection('users').doc(uid).collection('activities').get();
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.error('Batch delete error:', err);
  }
}

// Track saved planner data for restoring on load
let savedPlannerWeeks = null;


// ── Training Plan persistence ──
async function saveTrainingPlan(planData) {
  if (!currentUser) return;
  try {
    await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('current').set({
        plan: JSON.stringify(planData),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch(e) { console.error('Error saving plan:', e); }
}

async function loadTrainingPlan() {
  if (!currentUser) return null;
  try {
    const doc = await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('current').get();
    if (doc.exists && doc.data().plan) {
      return JSON.parse(doc.data().plan);
    }
  } catch(e) { console.error('Error loading plan:', e); }
  return null;
}

async function saveZwoFiles(zwoData) {
  if (!currentUser) return;
  try {
    await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('zwo_files').set({
        files: JSON.stringify(zwoData),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch(e) { console.error('Error saving ZWO files:', e); }
}

async function loadZwoFiles() {
  if (!currentUser) return {};
  try {
    const doc = await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('zwo_files').get();
    if (doc.exists && doc.data().files) {
      return JSON.parse(doc.data().files);
    }
  } catch(e) { console.error('Error loading ZWO files:', e); }
  return {};
}

async function savePlanCompletions(completions) {
  if (!currentUser) return;
  try {
    await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('completions').set({
        data: JSON.stringify(completions),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch(e) { console.error('Error saving completions:', e); }
}

async function loadPlanCompletions() {
  if (!currentUser) return {};
  try {
    const doc = await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('completions').get();
    if (doc.exists && doc.data().data) {
      return JSON.parse(doc.data().data);
    }
  } catch(e) { console.error('Error loading completions:', e); }
  return {};
}


// ── Pending FIT files from email ──
async function loadPendingFits() {
  if (!currentUser) return [];
  try {
    const snap = await db.collection('users').doc(currentUser.uid)
      .collection('pending_fits')
      .where('processed', '==', false)
      .get();
    const pending = [];
    snap.forEach(doc => {
      pending.push({ id: doc.id, ...doc.data() });
    });
    return pending;
  } catch(e) { console.error('Error loading pending FITs:', e); }
  return [];
}

async function markPendingFitProcessed(docId) {
  if (!currentUser) return;
  try {
    await db.collection('users').doc(currentUser.uid)
      .collection('pending_fits').doc(docId).update({ processed: true });
  } catch(e) { console.error('Error marking FIT processed:', e); }
}
