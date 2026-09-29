// ══════════════════════════════════════════════
// Activity detail
// ══════════════════════════════════════════════
// Opens from the Log. Shows stats, map, stream charts, laps, zones, and lets the user add notes,
// RPE and feel (saved on the activity). Strava data (streams, laps, full route) is fetched when the
// activity is opened — 2 requests — so nothing large is stored.

let detailActivity = null;
let detailCharts = [];
let detailMap = null;
let leafletLoading = null;
const FEELS = [['1', '😫', 'Terrible'], ['2', '😕', 'Poor'], ['3', '😐', 'Normal'], ['4', '🙂', 'Good'], ['5', '🤩', 'Great']];

// Google encoded polyline → [[lat, lng], ...]
function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lng = 0;
  while (str && i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

// Keep at most `max` evenly spaced points (charts stay fast on long activities)
function downsample(arr, max = 600) {
  if (!arr || arr.length <= max) return arr || [];
  const step = arr.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = resolve;
    js.onerror = () => { leafletLoading = null; reject(new Error('Map library failed to load')); };
    document.head.appendChild(js);
  });
  return leafletLoading;
}

function fmtSpeedFor(a, mps) {
  if (!(mps > 0)) return '—';
  if (a.sport === 'swimming') { const s = Math.round(100 / mps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/100m`; }
  if (isRun(a.sport)) return fmtPaceFromSpeed(mps);
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function detailStatsHtml(a) {
  const st = a.streamStats || {};
  const items = [
    ['Duration', fmtDuration(a.duration)],
    ['Distance', fmtDist(a.distance, a.sport)],
    ['Elevation', a.elevationGain ? `${a.elevationGain} m` : null],
    ['TSS', a.tss || null],
    ['IF', a.intensityFactor ? a.intensityFactor.toFixed(2) : null],
    [isRun(a.sport) || a.sport === 'swimming' ? 'Avg pace' : 'Avg speed', a.avgSpeed ? fmtSpeedFor(a, a.avgSpeed) : null],
    ['Avg HR', a.avgHr ? `${a.avgHr} bpm` : null],
    ['Max HR', a.maxHr ? `${a.maxHr} bpm` : null],
    ['Avg power', a.avgPower ? `${a.avgPower} W` : null],
    ['NP', a.np ? `${a.np} W` : null],
    ['Decoupling', st.decoupling != null ? `${st.decoupling}%` : null],
    ['Energy', a.calories ? `${a.calories} kJ` : null],
  ].filter(([, v]) => v != null && v !== '—');
  return `<div class="detail-stats">${items.map(([k, v]) => `<div class="detail-stat"><div class="detail-stat-label">${escapeHtml(k)}</div><div class="detail-stat-value">${escapeHtml(v)}</div></div>`).join('')}</div>`;
}

function detailZonesHtml(a) {
  const hist = a.streamStats && a.streamStats.hist;
  if (!hist) return '';
  const th = thresholdsAt(a.startDate);
  return (hist.hr ? zoneBarHtml('Heart rate zones', HR_ZONES.names, zonesFromHist(hist.hr, +th.lthr, HR_ZONES)) : '')
    + (hist.pw ? zoneBarHtml('Power zones', POWER_ZONES.names, zonesFromHist(hist.pw, +th.ftp, POWER_ZONES)) : '');
}

function detailJournalHtml(a) {
  const rpeOpts = ['<option value="">—</option>', ...Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}"${+a.rpe === i + 1 ? ' selected' : ''}>${i + 1}</option>`)].join('');
  const feels = FEELS.map(([v, e, label]) => `<button type="button" class="feel-btn${String(a.feel) === v ? ' is-active' : ''}" aria-pressed="${String(a.feel) === v}" data-feel="${v}" onclick="setActivityFeel(this.dataset.feel)" title="${label}" aria-label="${label}">${e}</button>`).join('');
  return `<div class="detail-journal">
    <div class="detail-journal-row">
      <label class="settings-label" for="detailRpe" style="margin:0">RPE</label>
      <select class="compare-select" id="detailRpe" onchange="saveActivityJournal()">${rpeOpts}</select>
      <span class="settings-label" style="margin:0 0 0 8px">Feel</span><div class="feel-group" role="group" aria-label="How did it feel">${feels}</div>
    </div>
    <label class="settings-label" for="detailNotes">Notes</label>
    <textarea id="detailNotes" class="settings-input detail-notes" rows="3" placeholder="How did it go? Conditions, sensations, nutrition…" onchange="saveActivityJournal()">${escapeHtml(a.notes || '')}</textarea>
    <div class="insight-muted" id="detailSaved" aria-live="polite"></div>
  </div>`;
}

async function openActivityDetail(activityId) {
  const a = allActivities.find(x => x.id === activityId);
  if (!a) return;
  detailActivity = a;
  const dlg = document.getElementById('activityDialog');
  const sid = typeof stravaIdOf === 'function' ? stravaIdOf(a) : null;
  const title = a.name || `${fmtSportName(a.sport)} · ${a.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  document.getElementById('activityDialogBody').innerHTML = `
    <div class="detail-head">
      <div style="min-width:0">
        <div class="detail-title">${escapeHtml(title)}</div>
        <div class="plan-subtitle"><span class="sport-tag sport-tag--${sportTagClass(a.sport)}">${sportEmoji(a.sport)} ${escapeHtml(fmtSportName(a.sport))}</span> ${escapeHtml(fmtDate(a.startDate))}</div>
      </div>
      <button class="btn-reset detail-close" onclick="closeActivityDetail()" aria-label="Close">✕</button>
    </div>
    ${detailStatsHtml(a)}
    ${detailJournalHtml(a)}
    <div id="detailMap" class="detail-map" hidden></div>
    <div id="detailCharts"></div>
    <div id="detailZones">${detailZonesHtml(a)}</div>
    <div id="detailLaps"></div>
    <div class="insight-muted" id="detailStatus"></div>
    ${sid ? `<a class="strava-link" href="https://www.strava.com/activities/${encodeURIComponent(sid)}" target="_blank" rel="noopener">View on Strava</a>` : ''}`;
  if (!dlg.open) dlg.showModal();
  destroyDetailVisuals();
  if (a.polyline) drawDetailMap(decodePolyline(a.polyline));
  if (sid && typeof stravaTokens !== 'undefined' && stravaTokens) loadStravaDetail(a, sid);
  else if (!sid) document.getElementById('detailStatus').textContent = 'Charts and laps are available for activities imported from Strava.';
}

function closeActivityDetail() {
  destroyDetailVisuals();
  const dlg = document.getElementById('activityDialog');
  if (dlg.open) dlg.close();
  detailActivity = null;
}

function destroyDetailVisuals() {
  detailCharts.forEach(c => c.destroy());
  detailCharts = [];
  if (detailMap) { detailMap.remove(); detailMap = null; }
}

async function drawDetailMap(points) {
  const el = document.getElementById('detailMap');
  if (!el || points.length < 2) return;
  try {
    await loadLeaflet();
    if (!document.getElementById('detailMap')) return; // closed meanwhile
    el.hidden = false;
    if (detailMap) detailMap.remove();
    detailMap = L.map(el, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' }).addTo(detailMap);
    const line = L.polyline(points, { color: '#f43f5e', weight: 3 }).addTo(detailMap);
    detailMap.fitBounds(line.getBounds(), { padding: [16, 16] });
  } catch (err) {
    console.error('Map error:', err);
  }
}

// Streams + laps + full-resolution route from Strava, fetched when the activity is opened
async function loadStravaDetail(a, sid) {
  const status = document.getElementById('detailStatus');
  status.textContent = 'Loading charts from Strava…';
  try {
    if (!(await ensureValidToken())) { status.textContent = ''; return; }
    const auth = { headers: { 'Authorization': `Bearer ${stravaTokens.access_token}` } };
    const [detRes, strRes] = await Promise.all([
      fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}`, auth),
      fetch(`https://www.strava.com/api/v3/activities/${encodeURIComponent(sid)}/streams?keys=time,heartrate,watts,velocity_smooth,altitude,latlng&key_by_type=true`, auth),
    ]);
    if (detailActivity !== a) return; // another activity opened meanwhile
    if (detRes.status === 429 || strRes.status === 429) { status.textContent = 'Strava rate limit reached — try again in 15 minutes.'; return; }
    const det = detRes.ok ? await detRes.json() : null;
    const streams = strRes.ok ? await strRes.json() : null;
    status.textContent = '';
    if (det) {
      // Backfill name / route for activities synced before these fields existed
      const upd = {};
      if (!a.name && det.name) upd.name = a.name = String(det.name).slice(0, 200);
      if (!a.polyline && det.map && det.map.summary_polyline) upd.polyline = a.polyline = det.map.summary_polyline;
      if (Object.keys(upd).length && typeof updateActivityFields === 'function') updateActivityFields(a.id, upd);
      const titleEl = upd.name && document.querySelector('#activityDialogBody .detail-title');
      if (titleEl) titleEl.textContent = a.name;
      const full = det.map && (det.map.polyline || det.map.summary_polyline);
      if (full && !detailMap) drawDetailMap(decodePolyline(full));
      renderDetailLaps(a, det.laps || []);
    }
    if (streams) {
      if (!detailMap && streams.latlng && streams.latlng.data && streams.latlng.data.length > 1) drawDetailMap(downsample(streams.latlng.data, 1500));
      // Also refresh the stored stats if they were missing
      if (!(a.streamStats && a.streamStats.v === STREAM_STATS_VERSION)) {
        a.streamStats = computeStreamStats(streams, a.sport);
        if (typeof updateActivityFields === 'function') updateActivityFields(a.id, { streamStats: a.streamStats });
        document.getElementById('detailZones').innerHTML = detailZonesHtml(a);
      }
      renderDetailCharts(a, streams);
    }
  } catch (err) {
    console.error('Activity detail error:', err);
    if (detailActivity === a) status.textContent = 'Could not load details from Strava.';
  }
}

function renderDetailCharts(a, streams) {
  const time = streams.time && streams.time.data;
  const box = document.getElementById('detailCharts');
  if (!time || !box || typeof Chart === 'undefined') return;
  const series = [
    ['heartrate', 'Heart rate', 'bpm', '#f43f5e', v => v],
    [isCyc(a.sport) ? 'watts' : null, 'Power', 'W', '#f59e0b', v => v],
    ['velocity_smooth', isCyc(a.sport) ? 'Speed' : 'Pace', isCyc(a.sport) ? 'km/h' : 'min/km', '#3b82f6',
      v => (isCyc(a.sport) ? +(v * 3.6).toFixed(1) : v > 0.5 ? +(1000 / v / 60).toFixed(2) : null)],
    ['altitude', 'Elevation', 'm', '#10b981', v => Math.round(v)],
  ].filter(([k]) => k && streams[k] && streams[k].data && streams[k].data.some(v => v));
  box.innerHTML = series.map((_, i) => `<div class="detail-chart"><canvas id="detailChart${i}"></canvas></div>`).join('');
  const idx = downsample(time.map((_, i) => i), 600);
  const labels = idx.map(i => fmtDuration(time[i]) === '—' ? '0m' : fmtDuration(time[i]));
  series.forEach(([key, label, unit, color, conv], i) => {
    const data = idx.map(j => { const v = streams[key].data[j]; return v == null ? null : conv(v); });
    detailCharts.push(new Chart(document.getElementById(`detailChart${i}`).getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ label: `${label} (${unit})`, data, borderColor: color, backgroundColor: color + '22', fill: key === 'altitude', pointRadius: 0, borderWidth: 1.5, tension: 0.2, spanGaps: true }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#a3a8bc', boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${label}: ${key === 'velocity_smooth' && !isCyc(a.sport) ? fmtPaceFromSpeed(1000 / (c.raw * 60)) : `${c.raw} ${unit}`}` } } },
        scales: { x: { ticks: { color: '#858aa3', maxTicksLimit: 6 }, grid: { color: 'rgba(42,45,62,0.3)' } },
                  y: { reverse: key === 'velocity_smooth' && !isCyc(a.sport), ticks: { color: '#858aa3', maxTicksLimit: 5 }, grid: { color: 'rgba(42,45,62,0.3)' } } },
      },
    }));
  });
}

function renderDetailLaps(a, laps) {
  const box = document.getElementById('detailLaps');
  if (!box || laps.length < 2) return;
  const rows = laps.map((l, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(fmtDuration(l.moving_time || l.elapsed_time))}</td><td>${escapeHtml(fmtDist(Math.round(l.distance || 0), a.sport))}</td><td>${escapeHtml(fmtSpeedFor(a, l.average_speed))}</td><td>${l.average_heartrate ? Math.round(l.average_heartrate) : '—'}</td><td>${l.average_watts ? Math.round(l.average_watts) + ' W' : '—'}</td></tr>`).join('');
  box.innerHTML = `<div class="zone-block-title" style="margin-top:16px">Laps</div><div class="plan-steps-wrap"><table class="plan-steps"><thead><tr><th>#</th><th>Time</th><th>Dist</th><th>${isRun(a.sport) || a.sport === 'swimming' ? 'Pace' : 'Speed'}</th><th>HR</th><th>Power</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── Journal: notes, RPE, feel ──
function setActivityFeel(v) {
  if (!detailActivity) return;
  detailActivity.feel = String(detailActivity.feel) === v ? null : v; // tap again to clear
  document.querySelectorAll('.feel-btn').forEach(b => { const on = b.dataset.feel === String(detailActivity.feel); b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  saveActivityJournal();
}

async function saveActivityJournal() {
  const a = detailActivity;
  if (!a) return;
  a.notes = (document.getElementById('detailNotes')?.value || '').slice(0, 5000);
  a.rpe = +(document.getElementById('detailRpe')?.value || 0) || null;
  const ok = typeof updateActivityFields === 'function' ? await updateActivityFields(a.id, { notes: a.notes, rpe: a.rpe, feel: a.feel || null }) : false;
  const s = document.getElementById('detailSaved');
  if (s) s.textContent = ok ? 'Saved' : 'Could not save — check your connection';
}
