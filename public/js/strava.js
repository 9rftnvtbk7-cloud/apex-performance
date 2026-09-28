// ══════════════════════════════════════════════
// Strava Integration Module
// ══════════════════════════════════════════════

// ── Configuration ──
// CLIENT_ID is now handled server-side in your Cloud Functions for better security.
const STRAVA_CLIENT_ID = '222662'; 
const STRAVA_REDIRECT_URI = window.location.origin; // Automatically matches your app URL (e.g., https://apex-performance-1fe0a.web.app)

// Cloudflare Worker (worker/) that holds the Strava Client Secret — set to the URL printed by `wrangler deploy`
const STRAVA_PROXY_URL = 'https://apex-strava.t4ng9shfbw.workers.dev';
const STRAVA_STATE_KEY = 'stravaOAuthState';
// Re-check the last 7 days on each sync to catch activities uploaded late
const STRAVA_RESYNC_OVERLAP_SEC = 7 * 86400;

// ── State ──
let stravaTokens = null; // { access_token, refresh_token, expires_at }

// POST to the Strava token proxy with the user's Firebase ID token
async function callAuthedFunction(name, body) {
  if (!currentUser) throw new Error('Not signed in');
  if (STRAVA_PROXY_URL.includes('YOUR-SUBDOMAIN')) throw new Error('Strava proxy URL not configured');
  const idToken = await currentUser.getIdToken();
  return fetch(`${STRAVA_PROXY_URL}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
    body: JSON.stringify(body)
  });
}

// Resolves with the signed-in user once Firebase Auth has restored the session
function waitForAuthUser() {
  return new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(user => { unsub(); resolve(user); });
  });
}

// ══════════════════════════════════════════════
// OAuth Flow
// ══════════════════════════════════════════════

function stravaConnect() {
  if (!currentUser) { showToast('Sign in first', '⚠️'); return; }
  
  const scope = 'read,activity:read_all';
  // Random CSRF token, verified when Strava redirects back
  const state = crypto.randomUUID();
  sessionStorage.setItem(STRAVA_STATE_KEY, state);
  
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

  if (!code && !error) return;

  // Clean the URL so the code isn't visible in the address bar
  window.history.replaceState({}, document.title, window.location.pathname);

  const expectedState = sessionStorage.getItem(STRAVA_STATE_KEY);
  sessionStorage.removeItem(STRAVA_STATE_KEY);

  if (error) {
    showToast('Strava authorization denied', '❌');
    return;
  }

  if (!state || !expectedState || state !== expectedState) {
    console.warn('Strava OAuth state mismatch — ignoring callback');
    showToast('Strava connection failed: invalid state, please try again', '❌');
    return;
  }

  if (!(await waitForAuthUser())) {
    showToast('Sign in first, then connect Strava', '⚠️');
    return;
  }

  showToast('Connecting to Strava…', '⏳');
  console.info('[Strava] Callback received, exchanging code');

  try {
    // Exchange code for tokens via the Worker (which holds the Client Secret)
    const response = await callAuthedFunction('stravaTokenExchange', { code });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Token exchange failed');
    }

    const data = await response.json();
    console.info('[Strava] Token exchange OK');
    stravaTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      athlete: data.athlete
    };

    // Update the UI now; don't block on Firestore's server acknowledgement
    // (writes are queued locally and sync when the connection allows)
    updateStravaUI();
    showToast(`Connected to Strava as ${data.athlete?.firstname || 'athlete'}`, '🔶');
    saveStravaTokens().then(ok => console.info(ok ? '[Strava] Tokens saved to Firestore' : '[Strava] Token save failed'));

  } catch (err) {
    console.error('Strava OAuth error:', err);
    showToast('Strava connection failed: ' + err.message, '❌');
  }
}

// ══════════════════════════════════════════════
// Token Management
// ══════════════════════════════════════════════

async function saveStravaTokens() {
  if (!currentUser || !stravaTokens) return false;
  try {
    await db.collection('users').doc(currentUser.uid).collection('settings').doc('strava').set({
      access_token: stravaTokens.access_token,
      refresh_token: stravaTokens.refresh_token,
      expires_at: stravaTokens.expires_at,
      athlete: stravaTokens.athlete || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return true;
  } catch (e) {
    console.error('Error saving Strava tokens:', e);
    showToast('Could not save Strava connection — you may need to reconnect', '⚠️');
    return false;
  }
}

async function loadStravaTokens() {
  if (!currentUser) return;
  try {
    const doc = await db.collection('users').doc(currentUser.uid).collection('settings').doc('strava').get();
    // Don't overwrite fresher tokens from an OAuth callback that finished while we were reading
    if (doc.exists && !stravaTokens) {
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
    const response = await callAuthedFunction('stravaTokenRefresh', {
      refresh_token: stravaTokens.refresh_token
    });
    if (!response.ok) throw new Error('Refresh failed');
    const data = await response.json();
    
    stravaTokens.access_token = data.access_token;
    stravaTokens.refresh_token = data.refresh_token;
    stravaTokens.expires_at = data.expires_at;

    saveStravaTokens(); // queued locally; don't block the sync on the server ack
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

  let imported = 0;
  try {
    // Strava IDs already imported (stored as fileName "strava_<id>"): the reliable duplicate check
    const stravaIdOf = a => (/^strava_(\d+)$/.exec(a.fileName || '') || [])[1];
    const knownIds = new Set(allActivities.map(stravaIdOf).filter(Boolean));

    // Resume from the newest Strava activity we have, minus a week: activities uploaded late
    // (e.g. synced from a head unit days later) have older start dates and would be missed.
    // With `after` set (0 = everything), Strava returns oldest first, so an interrupted
    // first sync resumes cleanly next time.
    let newestMs = 0;
    for (const a of allActivities) if (stravaIdOf(a) && a.startDate.getTime() > newestMs) newestMs = a.startDate.getTime();
    const afterEpoch = newestMs ? Math.floor(newestMs / 1000) - STRAVA_RESYNC_OVERLAP_SEC : 0;

    const perPage = 200;   // Strava's maximum
    const maxPages = 50;   // 10,000 activities per sync, well within the 100 requests / 15 min limit
    let totalFetched = 0;
    let hitPageLimit = false;

    for (let page = 1; ; page++) {
      const url = `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}&after=${afterEpoch}`;
      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${stravaTokens.access_token}` }
      });

      if (resp.status === 429) {
        showToast('Strava rate limit hit — imported what we could, sync again in 15 minutes', '⚠️');
        break;
      }
      if (!resp.ok) throw new Error(`Strava API error: ${resp.status}`);

      const activities = await resp.json();
      if (!activities.length) break;
      totalFetched += activities.length;

      const fresh = [];
      for (const sa of activities) {
        if (knownIds.has(String(sa.id))) continue;
        const act = stravaToActivity(sa);
        if (!act) continue;
        // Also skip activities already imported another way (e.g. a .FIT upload of the same ride)
        const isDup = allActivities.some(a =>
          !stravaIdOf(a) && a.sport === act.sport &&
          Math.abs(a.startDate.getTime() - act.startDate.getTime()) < 60000
        );
        if (isDup) continue;
        const tssInfo = computeTSS(act);
        act.tss = tssInfo.tss;
        act.intensityFactor = tssInfo.intensityFactor;
        fresh.push(act);
        knownIds.add(String(sa.id));
      }

      if (fresh.length) {
        if (typeof saveActivitiesBatch === 'function' && currentUser) await saveActivitiesBatch(fresh);
        allActivities.push(...fresh);
        imported += fresh.length;
        if (activities.length === perPage) showToast(`Imported ${imported} activities so far…`, '🔶');
      }

      if (activities.length < perPage) break;
      if (page >= maxPages) { hitPageLimit = true; break; }
    }

    if (imported > 0) {
      showToast(`Imported ${imported} new activit${imported > 1 ? 'ies' : 'y'} from Strava`, '🔶');
    } else {
      showToast(`Already up to date (checked ${totalFetched} activities)`, '✅');
    }
    if (hitPageLimit) showToast('More activities remain — click Sync Strava again to continue', 'ℹ️');

    if (currentUser) {
      db.collection('users').doc(currentUser.uid).collection('settings').doc('strava').update({
        lastSync: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(() => {});
    }

  } catch (err) {
    console.error('Strava sync error:', err);
    showToast('Strava sync failed: ' + err.message, '❌');
  } finally {
    // Show whatever was imported, even if a later page failed
    if (imported > 0 && typeof refreshDashboard === 'function') refreshDashboard();
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

  // sport_type is Strava's newer, more specific field (e.g. TrailRun, GravelRide)
  const sport = sportMap[sa.sport_type] || sportMap[sa.type] || 'other';
  // Only trust power from a real power meter; Strava's estimated watts would skew TSS
  const hasDevicePower = sa.device_watts === true;

  return {
    sport,
    startDate: new Date(sa.start_date),
    duration: sa.moving_time || sa.elapsed_time || 0,
    distance: Math.round(sa.distance || 0),
    avgHr: sa.average_heartrate ? Math.round(sa.average_heartrate) : null,
    maxHr: sa.max_heartrate ? Math.round(sa.max_heartrate) : null,
    avgPower: hasDevicePower && sa.average_watts ? Math.round(sa.average_watts) : null,
    np: hasDevicePower && sa.weighted_average_watts ? Math.round(sa.weighted_average_watts) : null,
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