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
      if (s.swimPace) document.getElementById('inputSwimPace').value = s.swimPace;
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

    // Keep stored TSS in line with the current formulas and thresholds
    const changed = recomputeAllTss();
    if (changed.length) {
      log(`[DB] Recalculated TSS for ${changed.length} activities`, 'info');
      updateActivitiesTss(changed);
    }

    log(`[DB] Loaded ${allActivities.length} activities`, 'ok');
    showToast(`Loaded ${allActivities.length} activities`, '✅');
    refreshDashboard();

  } catch (err) {
    console.error('Load error:', err);
    showToast('Error loading data', '❌');
  }
}

// Firestore batches allow 500 writes; stay safely below
const BATCH_LIMIT = 450;

function activityToDoc(activity) {
  return {
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
}

// ── Save activity to Firestore ──
async function saveActivity(activity) {
  if (!currentUser) return null;
  try {
    const ref = await db.collection('users').doc(currentUser.uid).collection('activities').add(activityToDoc(activity));
    return ref.id;
  } catch (err) {
    console.error('Save error:', err);
    showToast('Error saving activity', '❌');
    return null;
  }
}

// ── Save many activities in batches; sets `id` on each saved activity. Throws on failure. ──
async function saveActivitiesBatch(activities) {
  if (!currentUser || !activities.length) return;
  const col = db.collection('users').doc(currentUser.uid).collection('activities');
  for (let i = 0; i < activities.length; i += BATCH_LIMIT) {
    const chunk = activities.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    const refs = chunk.map(a => { const ref = col.doc(); batch.set(ref, activityToDoc(a)); return ref; });
    await batch.commit();
    chunk.forEach((a, j) => { a.id = refs[j].id; });
  }
}

// ── Delete activities by id in batches. Returns true if all were deleted. ──
async function deleteActivities(ids) {
  if (!currentUser) return false;
  const col = db.collection('users').doc(currentUser.uid).collection('activities');
  try {
    for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      ids.slice(i, i + BATCH_LIMIT).forEach(id => batch.delete(col.doc(id)));
      await batch.commit();
    }
    return true;
  } catch (err) {
    console.error('Delete error:', err);
    return false;
  }
}

// ── Update TSS / IF after threshold changes (Firestore batches max 500 writes) ──
async function updateActivitiesTss(activities) {
  if (!currentUser) return;
  const col = db.collection('users').doc(currentUser.uid).collection('activities');
  const withIds = activities.filter(a => a.id && !String(a.id).startsWith('local-'));
  try {
    for (let i = 0; i < withIds.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const a of withIds.slice(i, i + BATCH_LIMIT)) {
        batch.update(col.doc(a.id), { tss: a.tss || 0, intensityFactor: a.intensityFactor || null });
      }
      await batch.commit();
    }
  } catch (err) {
    console.error('TSS update error:', err);
    showToast('Error saving recalculated TSS', '❌');
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
      swimPace: document.getElementById('inputSwimPace').value || '2:00',
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

// ── Delete all activities. Returns true if everything was deleted. ──
async function deleteAllActivities() {
  if (!currentUser) return false;
  try {
    const snap = await db.collection('users').doc(currentUser.uid).collection('activities').get();
    return await deleteActivities(snap.docs.map(d => d.id));
  } catch (err) {
    console.error('Batch delete error:', err);
    return false;
  }
}

// Track saved planner data for restoring on load
let savedPlannerWeeks = null;


// ── Training Plan persistence ──
// Returns true when the plan was saved
async function saveTrainingPlan(planData) {
  if (!currentUser) return false;
  try {
    await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('current').set({
        plan: JSON.stringify(planData),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    return true;
  } catch(e) { console.error('Error saving plan:', e); return false; }
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


async function saveRaceDatesData(raceDates) {
  if (!currentUser) return;
  try {
    await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('raceDates').set({
        data: JSON.stringify(raceDates),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch(e) { console.error('Error saving race dates:', e); }
}

async function loadRaceDatesData() {
  if (!currentUser) return null;
  try {
    const doc = await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('raceDates').get();
    if (doc.exists && doc.data().data) {
      return JSON.parse(doc.data().data);
    }
  } catch(e) { console.error('Error loading race dates:', e); }
  return null;
}
