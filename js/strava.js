// ══════════════════════════════════════════════
// Strava Integration Module
// ══════════════════════════════════════════════

// ── Configuration ──
// CLIENT_ID is now handled server-side in your Cloud Functions for better security.
const STRAVA_CLIENT_ID = '222662'; 
const STRAVA_REDIRECT_URI = window.location.origin; // Automatically matches your app URL (e.g., https://apex-performance-1fe0a.web.app)

// ── State ──
let stravaTokens = null; // { access_token, refresh_token, expires_at }

// ══════════════════════════════════════════════
// OAuth Flow
// ══════════════════════════════════════════════

function stravaConnect() {
  if (!currentUser) { showToast('Sign in first', '⚠️'); return; }
  
  const scope = 'read,activity:read_all';
  const state = currentUser.uid; 
  
  // Directing the user to Strava for authorization
  const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&response_type=code&scope=${scope}&state=${state}&approval_prompt=auto`;
  
  window.location.href = authUrl;
}

function stravaDisconnect() {
  if (!confirm('Disconnect Strava? Your imported activities will remain.')) return;
  
  stravaTokens = null;
  if (currentUser) {
    db.collection('users').doc(currentUser.uid).collection('settings').doc('strava').delete()
      .catch(e => console.error('Error deleting Strava tokens:', e));
  }
  updateStravaUI();
  showToast('Strava disconnected', '✅');
}

async function handleStravaCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (!code) return; 

  // Clean the URL so the code isn't visible in the address bar
  window.history.replaceState({}, document.title, window.location.pathname);

  if (error) {
    showToast('Strava authorization denied', '❌');
    return;
  }

  showToast('Connecting to Strava…', '⏳');

  try {
    // Exchange code for tokens via your Cloud Function (which now holds the Client Secret)
    const response = await fetch(
      `https://us-central1-apex-performance-1fe0a.cloudfunctions.net/stravaTokenExchange`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, uid: state })
      }
    );

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Token exchange failed');
    }

    const data = await response.json();
    stravaTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete: data.athlete
    };

    await saveStravaTokens();
    updateStravaUI();
    showToast(`Connected to Strava as ${data.athlete?.firstname || 'athlete'}`, '🔶');

  } catch (err) {
    console.error('Strava OAuth error:', err);
    showToast('Strava connection failed: ' + err.message, '❌');
  }
}

// ══════════════════════════════════════════════
// Token Management
// ══════════════════════════════════════════════

async function saveStravaTokens() {
  if (!currentUser || !stravaTokens) return;
  try {
    await db.collection('users').doc(currentUser.uid).collection('settings').doc('strava').set({
      access_token: stravaTokens.access_token,
      refresh_token: stravaTokens.refresh_token,
      expires_at: stravaTokens.expires_at,
      athlete: stravaTokens.athlete || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) { console.error('Error saving Strava tokens:', e); }
}

async function loadStravaTokens() {
  if (!currentUser) return;
  try {
    const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('strava').get();
    if (doc.exists) {
      stravaTokens = doc.data();
      updateStravaUI();
    }
  } catch (e) { console.error('Error loading Strava tokens:', e); }
}

async function ensureValidToken() {
  if (!stravaTokens) return false;
  
  const now = Math.floor(Date.now() / 1000);
  if (stravaTokens.expires_at && stravaTokens.expires_at > now + 300) {
    return true; 
  }

  try {
    const response = await fetch(
      `https://us-central1-apex-performance-1fe0a.cloudfunctions.net/stravaTokenRefresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: stravaTokens.refresh_token,
          uid: currentUser.uid
        })
      }
    );
    if (!response.ok) throw new Error('Refresh failed');
    const data = await response.json();
    
    stravaTokens.access_token = data.access_token;
    stravaTokens.refresh_token = data.refresh_token;
    stravaTokens.expires_at = data.expires_at;
    
    await saveStravaTokens();
    return true;
  } catch (e) {
    console.error('Token refresh error:', e);
    showToast('Strava session expired — please reconnect', '⚠️');
    stravaTokens = null;
    updateStravaUI();
    return false;
  }
}

// ══════════════════════════════════════════════
// Activity Sync
// ══════════════════════════════════════════════

async function syncStravaActivities() {
  if (!stravaTokens) { showToast('Connect Strava first', '⚠️'); return; }
  if (!(await ensureValidToken())) return;

  const syncBtn = document.getElementById('btnStravaSync');
  if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = '⏳ Syncing…'; }

  showToast('Fetching activities from Strava…', '🔶');

  try {
    let afterEpoch = 0;
    if (typeof allActivities !== 'undefined' && allActivities.length) {
      const newest = allActivities.reduce((a, b) => a.startDate > b.startDate ? a : b);
      afterEpoch = Math.floor(newest.startDate.getTime() / 1000);
    }

    let page = 1;
    let imported = 0;
    let totalFetched = 0;
    const perPage = 100;

    while (true) {
      const url = `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}${afterEpoch ? '&after=' + afterEpoch : ''}`;
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${stravaTokens.access_token}` }
      });

      if (resp.status === 429) {
        showToast('Strava rate limit hit — try again in 15 minutes', '⚠️');
        break;
      }
      if (!resp.ok) throw new Error(`Strava API error: ${resp.status}`);

      const activities = await resp.json();
      if (!activities.length) break;

      totalFetched += activities.length;

      for (const sa of activities) {
        const act = stravaToActivity(sa);
        if (!act) continue;

        const isDup = allActivities.some(a =>
          Math.abs(a.startDate.getTime() - act.startDate.getTime()) < 60000 &&
          a.sport === act.sport
        );
        if (isDup) continue;

        if (typeof computeTSS === 'function') {
          const tssInfo = computeTSS(act);
          act.tss = tssInfo.tss;
          act.intensityFactor = tssInfo.intensityFactor;
        }

        if (typeof saveActivity === 'function' && currentUser) {
          const docId = await saveActivity(act);
          act.id = docId;
        }
        allActivities.push(act);
        imported++;
      }

      if (activities.length < perPage || page > 10) break;
      page++;
    }

    if (imported > 0) {
      showToast(`Imported ${imported} new activit${imported > 1 ? 'ies' : 'y'} from Strava`, '🔶');
      if (typeof refreshDashboard === 'function') refreshDashboard();
    } else {
      showToast(`Already up to date (checked ${totalFetched} activities)`, '✅');
    }

    if (currentUser) {
      db.collection('users').doc(currentUser.uid).collection('settings').doc('strava').update({
        lastSync: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
    }

  } catch (err) {
    console.error('Strava sync error:', err);
    showToast('Strava sync failed: ' + err.message, '❌');
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = '🔶 Sync Strava'; }
  }
}

function stravaToActivity(sa) {
  if (!sa || !sa.start_date) return null;

  const sportMap = {
    'Ride': 'cycling', 'VirtualRide': 'cycling', 'EBikeRide': 'e_biking', 'MountainBikeRide': 'cycling', 'GravelRide': 'cycling',
    'Run': 'running', 'VirtualRun': 'running', 'TrailRun': 'running',
    'Swim': 'swimming', 'Walk': 'walking', 'Hike': 'hiking',
    'WeightTraining': 'fitness_equipment', 'Workout': 'fitness_equipment', 'Yoga': 'yoga',
    'Rowing': 'rowing', 'Kayaking': 'kayaking', 'Canoeing': 'kayaking',
    'NordicSki': 'cross_country_skiing', 'AlpineSki': 'alpine_skiing', 'Snowboard': 'snowboarding',
    'IceSkate': 'ice_skating', 'RockClimbing': 'rock_climbing', 'Surfing': 'surfing',
    'Crossfit': 'fitness_equipment', 'Elliptical': 'fitness_equipment', 'StairStepper': 'fitness_equipment',
  };

  const sport = sportMap[sa.type] || sportMap[sa.sport_type] || 'other';

  return {
    sport,
    startDate: new Date(sa.start_date),
    duration: sa.moving_time || sa.elapsed_time || 0,
    distance: Math.round(sa.distance || 0),
    avgHr: sa.average_heartrate ? Math.round(sa.average_heartrate) : null,
    maxHr: sa.max_heartrate ? Math.round(sa.max_heartrate) : null,
    avgPower: sa.average_watts ? Math.round(sa.average_watts) : null,
    np: sa.weighted_average_watts ? Math.round(sa.weighted_average_watts) : null,
    avgSpeed: sa.average_speed || 0,
    calories: sa.kilojoules ? Math.round(sa.kilojoules) : null,
    tss: 0,
    intensityFactor: null,
    fileName: `strava_${sa.id}`,
    powerSamples: [],
    hrSamples: [],
  };
}

// ── UI Updates ──
function updateStravaUI() {
  const connectBtn = document.getElementById('btnStravaConnect');
  const syncBtn = document.getElementById('btnStravaSync');
  const disconnectBtn = document.getElementById('btnStravaDisconnect');
  const statusEl = document.getElementById('stravaStatus');

  if (stravaTokens && stravaTokens.access_token) {
    if (connectBtn) connectBtn.style.display = 'none';
    if (syncBtn) syncBtn.style.display = 'inline-flex';
    if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
    if (statusEl) {
      const name = stravaTokens.athlete ? `${stravaTokens.athlete.firstname} ${stravaTokens.athlete.lastname}` : 'Connected';
      statusEl.textContent = `🔶 ${name}`;
      statusEl.style.display = 'inline';
    }
  } else {
    if (connectBtn) connectBtn.style.display = 'inline-flex';
    if (syncBtn) syncBtn.style.display = 'none';
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    if (statusEl) statusEl.style.display = 'none';
  }
}