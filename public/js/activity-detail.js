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
const FEELS = [['1', 'Awful'], ['2', 'Poor'], ['3', 'OK'], ['4', 'Good'], ['5', 'Great']];
let detailStreams = null;
let detailChartKey = 'heartrate';

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

// Hero trio (distance, moving time, elevation) + 3×2 stat grid
function detailStatsHtml(a) {
  const st = a.streamStats || {};
  const km = a.distance ? (a.sport === 'swimming' ? [String(Math.round(a.distance)), 'm'] : [(a.distance / 1000).toFixed(1), 'km']) : null;
  const h = Math.floor((a.duration || 0) / 3600), m = Math.round(((a.duration || 0) % 3600) / 60);
  const time = a.duration ? (h ? [`${h}:${String(m).padStart(2, '0')}`, 'h'] : [String(m), 'min']) : null;
  const hero = [['Distance', km], ['Moving time', time], ['Elevation', a.elevationGain ? [String(a.elevationGain), 'm'] : null]]
    .filter(([, v]) => v).map(([k, [v, u]]) => `<div><div class="detail-hero__value">${escapeHtml(v)}<small>${u}</small></div><div class="detail-hero__label">${k}</div></div>`).join('');
  const speedLabel = isRun(a.sport) || a.sport === 'swimming' ? 'Avg pace' : 'Avg speed';
  const candidates = isCyc(a.sport)
    ? [[speedLabel, a.avgSpeed ? fmtSpeedFor(a, a.avgSpeed) : null], ['Avg power', a.avgPower ? `${a.avgPower} W` : null], ['NP', a.np ? `${a.np} W` : null], ['Avg HR', a.avgHr ? `${a.avgHr} bpm` : null]]
    : [[speedLabel, a.avgSpeed ? fmtSpeedFor(a, a.avgSpeed) : null], ['Avg HR', a.avgHr ? `${a.avgHr} bpm` : null], ['Max HR', a.maxHr ? `${a.maxHr} bpm` : null]];
  const items = [...candidates, ['TSS', a.tss || null], ['IF', a.intensityFactor ? a.intensityFactor.toFixed(2) : null], ['Decoupling', st.decoupling != null ? `${Math.round(st.decoupling)} %` : null], ['Energy', a.calories ? `${a.calories} kJ` : null], ['Max HR', isCyc(a.sport) && a.maxHr ? `${a.maxHr} bpm` : null]]
    .filter(([, v]) => v != null && v !== '—').slice(0, 6);
  return `${hero ? `<div class="detail-hero">${hero}</div>` : ''}
    <div class="detail-stats">${items.map(([k, v]) => `<div class="detail-stat"><div class="detail-stat-label">${escapeHtml(k)}</div><div class="detail-stat-value${k === 'TSS' ? ' tss' : ''}">${escapeHtml(v)}</div></div>`).join('')}</div>`;
}

function detailZonesHtml(a) {
  const hist = a.streamStats && a.streamStats.hist;
  if (!hist) return '';
  const th = thresholdsAt(a.startDate);
  return (hist.hr ? zoneBarHtml('Heart rate zones', HR_ZONES.names, zonesFromHist(hist.hr, +th.lthr, HR_ZONES)) : '')
    + (hist.pw ? zoneBarHtml('Power zones', POWER_ZONES.names, zonesFromHist(hist.pw, +th.ftp, POWER_ZONES)) : '');
}

// "How did it feel?": RPE 1–10 and a labelled 5-step feel scale (same stored values as before)
function detailJournalHtml(a) {
  const rpe = Array.from({ length: 10 }, (_, i) => `<button type="button" class="scale__opt" aria-pressed="${+a.rpe === i + 1}" data-rpe="${i + 1}" onclick="setActivityRpe(+this.dataset.rpe)">${i + 1}</button>`).join('');
  const feels = FEELS.map(([v, label]) => `<button type="button" class="scale__opt feel-btn" aria-pressed="${String(a.feel) === v}" data-feel="${v}" onclick="setActivityFeel(this.dataset.feel)">${label}</button>`).join('');
  return `<div class="detail-panel detail-feel">
    <h3>How did it feel?</h3>
    <div class="field-label">RPE</div><div class="scale" role="group" aria-label="Rate of perceived exertion, 1 to 10" id="detailRpe">${rpe}</div>
    <div class="field-label">Feel</div><div class="scale" role="group" aria-label="How did it feel">${feels}</div>
    <textarea id="detailNotes" class="input detail-notes" rows="3" aria-label="Notes" placeholder="How did it go? Conditions, sensations, nutrition…" onchange="saveActivityJournal()">${escapeHtml(a.notes || '')}</textarea>
    <div class="insight-muted" id="detailSaved" aria-live="polite"></div>
  </div>`;
}

async function openActivityDetail(activityId) {
  const a = allActivities.find(x => x.id === activityId);
  if (!a) return;
  detailActivity = a;
  detailStreams = null;
  detailChartKey = 'heartrate';
  const dlg = document.getElementById('activityDialog');
  const sid = typeof stravaIdOf === 'function' ? stravaIdOf(a) : null;
  const title = a.name || `${fmtSportName(a.sport)} · ${a.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const when = a.startDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + a.startDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('activityDialogBody').innerHTML = `
    <div class="detail-nav">
      <button class="btn-reset detail-back detail-close" onclick="closeActivityDetail()" aria-label="Close"><svg class="icon" aria-hidden="true"><use href="#i-chevron-left"/></svg>Activities</button>
      ${sid ? `<a class="strava-link" href="https://www.strava.com/activities/${encodeURIComponent(sid)}" target="_blank" rel="noopener">View on Strava</a>` : ''}
    </div>
    <h2 class="detail-title">${escapeHtml(title)}</h2>
    <div class="detail-sub">${typeof sportDot === 'function' ? sportDot(a.sport) : ''}${escapeHtml(typeof sportLabel === 'function' ? sportLabel(a.sport) : fmtSportName(a.sport))} · ${escapeHtml(when)}</div>
    ${detailStatsHtml(a)}
    <div id="detailMap" class="detail-map" hidden></div>
    <div class="detail-panel" id="detailChartPanel" hidden>
      <div class="segmented" role="group" aria-label="Chart" id="detailChartTabs"></div>
      <div class="detail-chart"><canvas id="detailChartCanvas"></canvas></div>
      <div id="detailZones">${detailZonesHtml(a)}</div>
    </div>
    ${detailJournalHtml(a)}
    <div id="detailLaps"></div>
    <div class="insight-muted" id="detailStatus"></div>`;
  if (!dlg.open) dlg.showModal();
  destroyDetailVisuals();
  // Zones can show before the streams arrive
  if (a.streamStats && a.streamStats.hist) document.getElementById('detailChartPanel').hidden = !detailZonesHtml(a);
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
    // OSM tiles (CARTO basemaps now need an API key); darkened with a CSS filter in the dark theme
    el.classList.toggle('detail-map--dark', !isLightTheme());
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '© OpenStreetMap contributors' }).addTo(detailMap);
    const line = L.polyline(points, { color: C().atl, weight: 3 }).addTo(detailMap);
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

// One chart, switched by a segmented control (Heart rate / Pace or Speed / Power / Elevation)
function renderDetailCharts(a, streams) {
  detailStreams = streams;
  const tabs = detailChartSeries(a, streams);
  const panel = document.getElementById('detailChartPanel');
  if (!tabs.length || !panel) return;
  if (!tabs.some(t => t.key === detailChartKey)) detailChartKey = tabs[0].key;
  document.getElementById('detailChartTabs').innerHTML = tabs.map(t => `<button class="segmented__opt${t.key === detailChartKey ? ' is-active' : ''}" aria-pressed="${t.key === detailChartKey}" data-key="${t.key}" onclick="showDetailChart(this.dataset.key)">${t.label}</button>`).join('');
  panel.hidden = false;
  drawDetailChart(a);
}

function detailChartSeries(a, streams) {
  const has = k => streams && streams[k] && streams[k].data && streams[k].data.some(v => v);
  if (!streams || !streams.time) return [];
  const pace = !isCyc(a.sport);
  return [
    has('heartrate') && { key: 'heartrate', label: 'Heart rate', unit: 'bpm', colorVar: 'atl', conv: v => v },
    has('velocity_smooth') && { key: 'velocity_smooth', label: pace ? 'Pace' : 'Speed', unit: pace ? 'min/km' : 'km/h', colorVar: 'ctl', reverse: pace,
      conv: v => (pace ? (v > 0.5 ? +(1000 / v / 60).toFixed(2) : null) : +(v * 3.6).toFixed(1)) },
    isCyc(a.sport) && has('watts') && { key: 'watts', label: 'Power', unit: 'W', colorVar: 'tss', conv: v => v },
    has('altitude') && { key: 'altitude', label: 'Elevation', unit: 'm', colorVar: 'tsb', fill: true, conv: v => Math.round(v) },
  ].filter(Boolean);
}

function showDetailChart(key) {
  detailChartKey = key;
  document.querySelectorAll('#detailChartTabs .segmented__opt').forEach(b => { const on = b.dataset.key === key; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  if (detailActivity) drawDetailChart(detailActivity);
}

function drawDetailChart(a) {
  const streams = detailStreams, series = detailChartSeries(a, streams).find(t => t.key === detailChartKey);
  const canvas = document.getElementById('detailChartCanvas');
  if (!series || !canvas || typeof Chart === 'undefined') return;
  detailCharts.forEach(c => c.destroy());
  detailCharts = [];
  const c = C(), color = c[series.colorVar];
  const time = streams.time.data;
  const idx = downsample(time.map((_, i) => i), 500);
  const labels = idx.map(i => { const t = time[i], h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}`; });
  const data = idx.map(j => { const v = streams[series.key].data[j]; return v == null ? null : series.conv(v); });
  const fmt = v => series.key === 'velocity_smooth' && series.reverse ? fmtPaceFromSpeed(1000 / (v * 60)) : `${v} ${series.unit}`;
  detailCharts.push(new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ label: series.label, data, borderColor: color, backgroundColor: withAlpha(color, 0.12), fill: !!series.fill, pointRadius: 0, borderWidth: 1.8, tension: 0.25, spanGaps: true }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...chartTooltip(), callbacks: { label: ctx => `${series.label}: ${fmt(ctx.raw)}` } } },
      scales: { x: chartScaleX({ ticks: { color: c.muted, maxTicksLimit: 4, maxRotation: 0 } }), y: chartScaleY({ reverse: !!series.reverse, ticks: { color: c.muted, maxTicksLimit: 4 } }) },
    },
  }));
}

function renderDetailLaps(a, laps) {
  const box = document.getElementById('detailLaps');
  if (!box || laps.length < 2) return;
  const power = isCyc(a.sport) && laps.some(l => l.average_watts);
  const pace = isRun(a.sport) || a.sport === 'swimming';
  const rows = laps.map((l, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(fmtDist(Math.round(l.distance || 0), a.sport))}</td><td>${escapeHtml(fmtSpeedFor(a, l.average_speed).replace('/km', ''))}</td>${power ? `<td>${l.average_watts ? Math.round(l.average_watts) + ' W' : '—'}</td>` : ''}<td>${l.average_heartrate ? Math.round(l.average_heartrate) : '—'}</td></tr>`).join('');
  box.innerHTML = `<div class="detail-laps"><table class="laps"><thead><tr><th>Lap</th><th>Dist</th><th>${pace ? 'Pace' : 'Speed'}</th>${power ? '<th>Power</th>' : ''}<th>HR</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── Journal: notes, RPE, feel ──
function setActivityFeel(v) {
  if (!detailActivity) return;
  detailActivity.feel = String(detailActivity.feel) === v ? null : v; // tap again to clear
  document.querySelectorAll('.feel-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.feel === String(detailActivity.feel))));
  saveActivityJournal();
}

function setActivityRpe(n) {
  if (!detailActivity) return;
  detailActivity.rpe = detailActivity.rpe === n ? null : n; // tap again to clear
  document.querySelectorAll('#detailRpe .scale__opt').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.rpe === detailActivity.rpe)));
  saveActivityJournal();
}

async function saveActivityJournal() {
  const a = detailActivity;
  if (!a) return;
  a.notes = (document.getElementById('detailNotes')?.value || '').slice(0, 5000);
  const ok = typeof updateActivityFields === 'function' ? await updateActivityFields(a.id, { notes: a.notes, rpe: a.rpe || null, feel: a.feel || null }) : false;
  const s = document.getElementById('detailSaved');
  if (s) s.textContent = ok ? 'Saved' : 'Could not save — check your connection';
}
