// ══════════════════════════════════════════════
// App State
// ══════════════════════════════════════════════
let allActivities = [];
let pmcResult = {};
let pmcChart = null;
let compareChart = null;
let plannerChart = null;
let sortConfig = { key: 'date', dir: 'desc' };
let plannerData = [];
let raceDates = [];
let plannerInited = false;
let currentRange = 182; // 6 months by default (handoff: 6M)
let seasonView = 'forecast';
const pmcHidden = { 2: true }; // chart series hidden by the user (Form off by default)
let logFilter = 'all';
let selectMode = false;
let sessionDataLoaded = false;
let forecastTssEdited = false;
let forecastDaysEdited = false;
let pmcSport = 'all';
let planOverrides = {}; // sessionId → 'YYYY-MM-DD' when moved in the Calendar

// ══════════════════════════════════════════════
// Safety & Date Helpers
// ══════════════════════════════════════════════
// Escape any value before interpolating it into HTML (text or attribute)
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Only allow plain hex / named colours from imported data into style attributes
function safeColor(c, fallback) { return /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(String(c || '')) ? c : fallback; }
// YYYY-MM-DD in the user's local timezone (toISOString() is UTC and shifts days)
function localDateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// Calendar-day arithmetic that stays at local midnight across DST changes
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

function log(msg, type) {
  console.log(msg);
  const el = document.getElementById('debugPanel');
  if (el) {
    const div = document.createElement('div');
    div.className = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : type === 'info' ? 'log-info' : '';
    div.textContent = msg;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }
}

// ══════════════════════════════════════════════
// Tab Navigation
// ══════════════════════════════════════════════
function switchTab(tabId, btn) {
  document.querySelectorAll('.nav-tab').forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
  if (btn) { btn.classList.add('is-active'); btn.setAttribute('aria-selected', 'true'); }
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('is-active', t.id === 'tab-' + tabId));
  window.scrollTo(0, 0);
  if (tabId === 'season') setSeasonView(seasonView);
  if (tabId === 'plan') scrollToCurrentWeek();
  if (tabId === 'calendar' && typeof renderCalendar === 'function') renderCalendar();
}

// ── Season: Forecast · Compare · Insights (one tab, segmented) ──
const SEASON_PANELS = { forecast: 'tab-planner', compare: 'tab-compare', insights: 'tab-insights' };
function setSeasonView(view) {
  seasonView = SEASON_PANELS[view] ? view : 'forecast';
  document.querySelectorAll('.season-view-btn').forEach(b => { const on = b.dataset.view === seasonView; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  for (const [v, id] of Object.entries(SEASON_PANELS)) document.getElementById(id)?.classList.toggle('is-active', v === seasonView);
  if (seasonView === 'forecast') initPlanner();
  if (seasonView === 'compare') { initCompareDefaults(); renderComparison(); }
  if (seasonView === 'insights') { if (typeof renderInsights === 'function') renderInsights(); if (typeof renderBestEfforts === 'function') setTimeout(renderBestEfforts, 60); }
}
function openSeason(view) {
  const btn = [...document.querySelectorAll('.nav-tab')].find(b => b.getAttribute('onclick')?.includes("'season'"));
  seasonView = view || seasonView;
  switchTab('season', btn);
}

// ══════════════════════════════════════════════
// TSS Calculation
// ══════════════════════════════════════════════
function computeTSS(act) {
  // Thresholds that were valid on the activity's date (see thresholds.js)
  const th = thresholdsAt(act.startDate);
  const ftp = +th.ftp || 200;
  const lthr = +th.lthr || 165;
  const ts = paceToSpd(th.pace || '5:00');
  const css = swimPaceToSpd(th.swimPace || '2:00');
  const d = act.duration;
  // Power-based TSS for cycling only: running power is not comparable to cycling FTP
  if (isCyc(act.sport) && ftp > 0 && (act.np > 0 || act.avgPower > 0)) { const p = act.np || act.avgPower, i = p / ftp; return { tss: Math.round(d * p * i / (ftp * 3600) * 100), intensityFactor: +i.toFixed(2) }; }
  if (isRun(act.sport) && act.avgSpeed > 0 && ts > 0) { const i = act.avgSpeed / ts; return { tss: Math.round(Math.min(d / 3600 * i * i * 100, 500)), intensityFactor: +i.toFixed(2) }; }
  // Swim TSS (sTSS): cubic in intensity relative to critical swim speed
  if (act.sport === 'swimming' && act.avgSpeed > 0 && css > 0) { const i = act.avgSpeed / css; return { tss: Math.round(Math.min(d / 3600 * i ** 3 * 100, 500)), intensityFactor: +i.toFixed(2) }; }
  if (act.avgHr > 0 && lthr > 0) { const i = act.avgHr / lthr; return { tss: Math.round(Math.min(d / 3600 * i * i * 100, 500)), intensityFactor: +i.toFixed(2) }; }
  return { tss: Math.round(Math.min(d / 3600 * 50, 500)), intensityFactor: null };
}
function isCyc(s) { return ['cycling', 'indoor_cycling', 'virtual_ride', 'e_biking'].includes(s); }
function isRun(s) { return ['running', 'walking', 'hiking', 'trail_running'].includes(s); }
function paceToSpd(s) { const p = s.split(':'); return 1000 / ((+p[0] || 5) * 60 + (+p[1] || 0)); }
function swimPaceToSpd(s) { const p = s.split(':'); return 100 / ((+p[0] || 2) * 60 + (+p[1] || 0)); }

// Recompute TSS/IF for every activity with the current formulas and thresholds.
// Returns the activities whose values changed (so callers can persist them).
function recomputeAllTss() {
  const changed = [];
  for (const a of allActivities) {
    const t = computeTSS(a);
    if (t.tss !== a.tss || t.intensityFactor !== a.intensityFactor) changed.push(a);
    a.tss = t.tss; a.intensityFactor = t.intensityFactor;
  }
  return changed;
}

// ══════════════════════════════════════════════
// PMC
// ══════════════════════════════════════════════
function computePMC() {
  if (!allActivities.length) return;
  const series = loadSeries(allActivities, pmcStartDate());
  const { labels, ctlVals: ctlV, atlVals: atlV, tsbVals: tsbV, tssVals: tssV } = series;
  const nDays = labels.length;
  const ctl = series.lastCtl, atl = series.lastAtl;
  pmcResult = { labels, ctlVals: ctlV, atlVals: atlV, tsbVals: tsbV, tssVals: tssV, lastCtl: ctl, lastAtl: atl };
  document.getElementById('valCtl').textContent = ctl.toFixed(1);
  document.getElementById('valAtl').textContent = atl.toFixed(1);
  const tsb = ctl - atl;
  const zone = tsbZone(tsb);
  document.getElementById('valTsb').textContent = `${tsb > 0 ? '+' : ''}${tsb.toFixed(1)}`;
  document.getElementById('subTsb').textContent = zone.label.split('—').pop().trim().replace(/^./, c => c.toUpperCase());
  document.getElementById('subTsb').style.color = zone.color;
  // Ramp rate: CTL change over the last 7 days
  const ramp = nDays > 7 ? ctlV[nDays - 1] - ctlV[nDays - 8] : null;
  const subCtl = document.getElementById('subCtl');
  if (ramp === null) { subCtl.textContent = '42-day exponential avg'; subCtl.style.color = ''; }
  else { const r = rampInfo(ramp); subCtl.textContent = `${ramp >= 0 ? '+' : '−'}${Math.abs(ramp).toFixed(1)} / wk`; subCtl.title = `Ramp rate: ${r.label}`; subCtl.style.color = ramp > 5 ? r.color : ''; }
  // Forecast defaults to "maintain current fitness" until the user types their own value
  if (!forecastTssEdited) document.getElementById('inputForecastTss').value = Math.round(ctl);
  // Weekly TSS stats
  const now = new Date(); now.setHours(0,0,0,0);
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const thisMonday = addDays(now, -dayOfWeek);
  const lastMonday = addDays(thisMonday, -7);
  const lastSunday = addDays(thisMonday, -1);
  let thisWeekTss = 0, lastWeekTss = 0, thisWeekCount = 0, lastWeekCount = 0;
  for (const a of allActivities) {
    const d = new Date(a.startDate); d.setHours(0,0,0,0);
    if (d >= thisMonday && d <= now) { thisWeekTss += (a.tss || 0); thisWeekCount++; }
    else if (d >= lastMonday && d <= lastSunday) { lastWeekTss += (a.tss || 0); lastWeekCount++; }
  }
  document.getElementById('valWeekTss').textContent = thisWeekTss.toLocaleString();
  document.getElementById('subWeekTss').textContent = `${thisWeekCount} activit${thisWeekCount === 1 ? 'y' : 'ies'} so far.`;
  document.getElementById('valLastWeekTss').textContent = lastWeekTss.toLocaleString();
  document.getElementById('subLastWeekTss').textContent = `${lastWeekCount} activit${lastWeekCount === 1 ? 'y' : 'ies'}`;

  // ── This Week Mini Summary ──
  renderWeekSummary(thisMonday, now, thisWeekTss, lastWeekTss);
}

function renderWeekSummary(thisMonday, now, thisWeekTss, lastWeekTss) {
  const summaryEl = document.getElementById('weekSummary');
  if (!summaryEl) return;
  summaryEl.style.display = allActivities.length ? '' : 'none';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const weekActs = allActivities.filter(a => { const d = new Date(a.startDate); d.setHours(0, 0, 0, 0); return d >= thisMonday && d <= today; });

  // Per-sport line (desktop)
  const buckets = { cycling: [], running: [], swimming: [], other: [] };
  for (const a of weekActs) buckets[isCyc(a.sport) ? 'cycling' : isRun(a.sport) ? 'running' : a.sport === 'swimming' ? 'swimming' : 'other'].push(a);
  const line = list => list.length ? `${list.length}× · ${fmtDuration(list.reduce((n, a) => n + (a.duration || 0), 0))}` : '—';
  document.getElementById('weekCyclingStats').textContent = line(buckets.cycling);
  document.getElementById('weekRunningStats').textContent = line(buckets.running);
  document.getElementById('weekSwimmingStats').textContent = line(buckets.swimming);
  document.getElementById('weekOtherStats').textContent = line(buckets.other);

  // Planned sessions this week (from the plan): one bar segment each, flex = planned TSS
  const bar = document.getElementById('weekProgressBar'), days = document.getElementById('weekProgressDays');
  const status = document.getElementById('weekProgressLabel');
  const sessions = [];
  if (trainingPlan) {
    const matches = matchPlanToActivities(trainingPlan);
    for (let i = 0; i < 7; i++) {
      const d = addDays(thisMonday, i);
      for (const s of sessionsOnDate(trainingPlan, d)) if (s.sport !== 'rest') sessions.push({ s, d, matched: matches.get(s.id) });
    }
  }
  const planned = plannedTssForWeek(thisMonday);
  const phase = trainingPlan && (trainingPlan.weeks || []).find(w => { const st = planWeekStart(w, trainingPlan); return st && localDateKey(st) === localDateKey(thisMonday); });
  document.getElementById('weekPhaseLabel').textContent = phase ? `W${String(phase.week).padStart(2, '0')}${phase.phase ? ' · ' + phase.phase[0] + phase.phase.slice(1).toLowerCase() : ''}` : '';

  if (sessions.length) {
    const doneCount = sessions.filter(x => x.matched || isSessionTicked(x.s)).length;
    const plannedSoFar = sessions.filter(x => x.d < today).reduce((n, x) => n + (x.s.tss || 0), 0);
    const total = planned ? planned.tss : sessions.reduce((n, x) => n + (x.s.tss || 0), 0);
    document.getElementById('weekProgressText').textContent = `/ ${total} TSS`;
    bar.innerHTML = sessions.map(x => {
      const done = x.matched || isSessionTicked(x.s);
      const state = done ? 'done' : localDateKey(x.d) === localDateKey(today) ? 'today' : x.d < today ? 'missed' : 'future';
      return `<span class="week-progress__seg week-progress__seg--${state}" style="flex:${Math.max(1, x.s.tss || 1)}" title="${escapeHtml(x.s.name)}"></span>`;
    }).join('');
    days.innerHTML = sessions.map(x => `<span style="flex:${Math.max(1, x.s.tss || 1)}">${localDateKey(x.d) === localDateKey(today) ? 'Today' : escapeHtml(x.d.toLocaleDateString('en-GB', { weekday: 'short' }))}</span>`).join('');
    bar.setAttribute('aria-label', `${doneCount} of ${sessions.length} planned sessions done`);
    // Status vs what was planned before today (today's session may still be ahead)
    const behind = plannedSoFar > 0 && thisWeekTss < plannedSoFar * 0.8;
    status.textContent = behind ? `Behind plan · ${Math.round(thisWeekTss / plannedSoFar * 100)} %` : '✓ On track';
    status.className = `week-card__status ${behind ? 'is-caution' : 'is-ok'}`;
    document.getElementById('subWeekTss').textContent = `${doneCount} of ${sessions.length} sessions done.`;
  } else {
    // No plan: compare with last week
    const goal = planned ? planned.tss : lastWeekTss || 0;
    document.getElementById('weekProgressText').textContent = goal ? `/ ${goal} TSS` : 'TSS';
    const pct = goal ? Math.min(100, Math.round(thisWeekTss / goal * 100)) : 0;
    bar.innerHTML = goal ? `<span class="week-progress__seg week-progress__seg--done" style="flex:${pct || 0.001}"></span><span class="week-progress__seg" style="flex:${100 - pct}"></span>` : '';
    days.innerHTML = '';
    status.textContent = goal ? `${pct} % of ${planned ? 'planned' : 'last week'}` : '';
    status.className = 'week-card__status';
  }
}

// Today page title + caption: "Tuesday 29 Sept" / "W04 · Build · 47 days to Saint-Nolff Trail"
function renderTodayHead(now = new Date()) {
  const title = document.getElementById('todayTitle'), cap = document.getElementById('todayCaption');
  if (!title) return;
  title.textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  const parts = [];
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const week = trainingPlan && (trainingPlan.weeks || []).find(w => isWeekCurrent(w, trainingPlan, now));
  if (week) parts.push(`W${String(week.week).padStart(2, '0')}`, week.phase ? week.phase[0] + week.phase.slice(1).toLowerCase() : '');
  const next = (raceDates || []).filter(r => r.date && parseIsoDate(r.date) >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (next) {
    const n = Math.round((parseIsoDate(next.date) - today) / 86400000);
    parts.push(n === 0 ? `Race day: ${next.name || 'race'}` : `${n} day${n > 1 ? 's' : ''} to ${next.name || 'race'}`);
    // Forecast reaches the next race (≤ 60 days) so its marker shows on the chart, until the user picks a length
    const slider = document.getElementById('sliderForecastDays');
    if (!forecastDaysEdited && n > 0 && n <= 60 && +slider.value !== n) {
      slider.value = n;
      document.getElementById('displayForecastDays').textContent = `${n} days`;
      if (pmcChart) buildPMCChart();
    }
  }
  cap.textContent = parts.filter(Boolean).join(' · ');
}

// Form (TSB) zones, as commonly used with the Performance Management Chart
function tsbZone(tsb) {
  if (tsb > 25) return { label: 'Transition — fitness fading', color: 'var(--color-amber)' };
  if (tsb > 5) return { label: 'Fresh — race ready', color: 'var(--color-green)' };
  if (tsb >= -10) return { label: 'Neutral — maintaining', color: 'var(--text-dim)' };
  if (tsb >= -30) return { label: 'Optimal — productive training', color: 'var(--color-blue)' };
  return { label: 'High risk — overreaching', color: 'var(--color-red)' };
}

// Weekly CTL ramp rate: ~5–8/week is a solid build; above 8 raises injury/illness risk
function rampInfo(ramp) {
  if (ramp > 8) return { label: 'too fast', color: 'var(--color-red)' };
  if (ramp > 5) return { label: 'aggressive build', color: 'var(--color-amber)' };
  if (ramp > 0) return { label: 'steady build', color: 'var(--color-green)' };
  if (ramp > -5) return { label: 'easing off', color: 'var(--text-dim)' };
  return { label: 'detraining / taper', color: 'var(--color-amber)' };
}

// First day of the fitness history (all sports), so per-sport series share the same dates
function pmcStartDate() {
  let min = null;
  for (const a of allActivities) if (!min || a.startDate < min) min = a.startDate;
  const d = new Date(min || new Date()); d.setHours(0, 0, 0, 0);
  return d;
}

// CTL (42-day) / ATL (7-day) / TSB series from `f0` to today for a set of activities
function loadSeries(acts, f0, today = new Date()) {
  const td = new Date(today); td.setHours(0, 0, 0, 0);
  const nDays = Math.max(1, Math.round((td - f0) / 86400000) + 1);
  const dTss = new Array(nDays).fill(0);
  const tssMap = {};
  for (const a of acts) {
    const d = new Date(a.startDate); d.setHours(0, 0, 0, 0);
    const i = Math.round((d - f0) / 86400000);
    if (i >= 0 && i < nDays) dTss[i] += (a.tss || 0);
    const k = localDateKey(a.startDate); tssMap[k] = (tssMap[k] || 0) + (a.tss || 0);
  }
  let ctl = 0, atl = 0;
  const labels = [], ctlVals = [], atlVals = [], tsbVals = [];
  for (let i = 0; i < nDays; i++) {
    ctl += (dTss[i] - ctl) / 42; atl += (dTss[i] - atl) / 7;
    labels.push(localDateKey(addDays(f0, i)));
    ctlVals.push(+ctl.toFixed(1)); atlVals.push(+atl.toFixed(1)); tsbVals.push(+(ctl - atl).toFixed(1));
  }
  const tssVals = labels.map(l => tssMap[l] !== undefined ? tssMap[l] : null);
  return { labels, ctlVals, atlVals, tsbVals, tssVals, lastCtl: ctl, lastAtl: atl };
}

// ── Fitness per sport ──
const PMC_SPORTS = { bike: { label: 'Bike', icon: 'bike', test: s => isCyc(s) }, run: { label: 'Run', icon: 'run', test: s => isRun(s) }, swim: { label: 'Swim', icon: 'swim', test: s => s === 'swimming' } };

function pmcSeriesFor(key) {
  if (key === 'all' || !PMC_SPORTS[key]) return pmcResult;
  return loadSeries(allActivities.filter(a => PMC_SPORTS[key].test(a.sport)), pmcStartDate());
}

function setPmcSport(key) {
  pmcSport = key;
  if (pmcChart) buildPMCChart();
}

// Chips under the stat cards: CTL and 7-day ramp per sport
function renderSportFitness() {
  const el = document.getElementById('sportFitness');
  if (!el) return;
  el.innerHTML = Object.entries(PMC_SPORTS).map(([key, sp]) => {
    if (!allActivities.some(a => sp.test(a.sport))) return '';
    const s = pmcSeriesFor(key), n = s.ctlVals.length;
    const ramp = n > 7 ? s.ctlVals[n - 1] - s.ctlVals[n - 8] : 0;
    const on = pmcSport === key;
    return `<button class="btn-reset sport-fitness-chip" aria-pressed="${on}" title="${sp.label} fitness, ${ramp >= 0 ? '+' : ''}${ramp.toFixed(1)} per week — click to chart"
      onclick="setPmcSport(pmcSport === '${key}' ? 'all' : '${key}'); renderSportFitness(); document.getElementById('pmcSportSelect').value = pmcSport;">
      ${sportDot(key)}${sp.label} ${s.lastCtl.toFixed(0)}</button>`;
  }).join('');
}

function computeSmallForecast(src = pmcResult) {
  const days = +document.getElementById('sliderForecastDays').value || 0;
  const avg = +document.getElementById('inputForecastTss').value || 0;
  if (!days || src.lastCtl == null) return { labels: [], ctl: [], atl: [], tsb: [] };
  let c = src.lastCtl, a = src.lastAtl;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const fl = [], fc = [], fa = [], ft = [];
  fl.push(localDateKey(now)); fc.push(+c.toFixed(1)); fa.push(+a.toFixed(1)); ft.push(+(c - a).toFixed(1));
  for (let i = 1; i <= days; i++) { c += (avg - c) / 42; a += (avg - a) / 7; fl.push(localDateKey(addDays(now, i))); fc.push(+c.toFixed(1)); fa.push(+a.toFixed(1)); ft.push(+(c - a).toFixed(1)); }
  return { labels: fl, ctl: fc, atl: fa, tsb: ft };
}

// ══════════════════════════════════════════════
// PMC Chart
// ══════════════════════════════════════════════
function buildPMCChart() {
  const ctx = document.getElementById('chartCanvas').getContext('2d');
  const src = pmcSeriesFor(pmcSport);
  const fc = computeSmallForecast(src);
  if (pmcChart) pmcChart.destroy();

  const mL = src.labels || [], fL = fc.labels || [];
  const fullLabels = [...mL]; for (const l of fL) if (!fullLabels.includes(l)) fullLabels.push(l);
  const pad = a => { const o = [...a]; while (o.length < fullLabels.length) o.push(null); return o; };
  const padF = a => { const si = fullLabels.indexOf(fL[0]); const o = new Array(fullLabels.length).fill(null); for (let i = 0; i < a.length; i++) if (si + i < o.length) o[si + i] = a[i]; return o; };

  let labels = fullLabels;
  let ctlData = pad(src.ctlVals || []);
  let atlData = pad(src.atlVals || []);
  let tsbData = pad(src.tsbVals || []);
  let tssData = pad(src.tssVals || []);
  let fcCtlData = padF(fc.ctl || []);
  let fcAtlData = padF(fc.atl || []);
  let fcTsbData = padF(fc.tsb || []);

  if (currentRange !== 'all') {
    let cutoff, endDate;
    if (typeof currentRange === 'object' && currentRange.from) {
      cutoff = currentRange.from;
      endDate = currentRange.to;
    } else {
      const days = parseInt(currentRange);
      const td = new Date(); td.setHours(0, 0, 0, 0);
      cutoff = localDateKey(addDays(td, -days));
      endDate = null;
    }
    let startIdx = labels.findIndex(l => l >= cutoff);
    if (startIdx < 0) startIdx = 0;
    labels = labels.slice(startIdx);
    ctlData = ctlData.slice(startIdx);
    atlData = atlData.slice(startIdx);
    tsbData = tsbData.slice(startIdx);
    tssData = tssData.slice(startIdx);
    fcCtlData = fcCtlData.slice(startIdx);
    fcAtlData = fcAtlData.slice(startIdx);
    fcTsbData = fcTsbData.slice(startIdx);
    if (endDate) {
      let endIdx = labels.findIndex(l => l > endDate);
      if (endIdx < 0) endIdx = labels.length;
      labels = labels.slice(0, endIdx);
      ctlData = ctlData.slice(0, endIdx);
      atlData = atlData.slice(0, endIdx);
      tsbData = tsbData.slice(0, endIdx);
      tssData = tssData.slice(0, endIdx);
      fcCtlData = fcCtlData.slice(0, endIdx);
      fcAtlData = fcAtlData.slice(0, endIdx);
      fcTsbData = fcTsbData.slice(0, endIdx);
    }
  }

  const c = C();
  const maxTss = Math.max(1, ...tssData.filter(v => v != null));
  const short = labels.length <= 70;
  pmcChart = new Chart(ctx, {
    type: 'line',
    plugins: [pmcOverlayPlugin(labels)],
    data: { labels, datasets: [
      { label: 'Fitness', data: ctlData, borderColor: c.ctl, backgroundColor: withAlpha(c.ctl, 0.08), borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 6, tension: 0.3, fill: 'origin', order: 2, spanGaps: true, hidden: !!pmcHidden[0] },
      { label: 'Fatigue', data: atlData, borderColor: withAlpha(c.atl, 0.6), borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 6, tension: 0.3, fill: false, order: 3, spanGaps: true, hidden: !!pmcHidden[1] },
      { label: 'Form', data: tsbData, borderColor: c.tsb, backgroundColor: withAlpha(c.tsb, 0.10), borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 6, tension: 0.3, fill: { target: { value: 0 } }, order: 4, spanGaps: true, hidden: !!pmcHidden[2] },
      { type: 'bar', label: 'TSS', data: tssData, backgroundColor: withAlpha(c.tss, 0.55), borderWidth: 0, barThickness: short ? 4 : 2, order: 1, yAxisID: 'y1', hidden: !!pmcHidden[3] },
      { label: 'Fitness forecast', data: fcCtlData, borderColor: withAlpha(c.ctl, 0.8), borderDash: [4, 4], borderWidth: 2, pointRadius: 0, fill: false, tension: 0.3, order: 5, spanGaps: false, hidden: !!pmcHidden[4] },
      { label: 'Fatigue forecast', data: fcAtlData, borderColor: withAlpha(c.atl, 0.45), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, order: 6, spanGaps: false, hidden: !!pmcHidden[4] || !!pmcHidden[1] },
      { label: 'Form forecast', data: fcTsbData, borderColor: withAlpha(c.tsb, 0.6), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, order: 7, spanGaps: false, hidden: !!pmcHidden[4] || !!pmcHidden[2] },
    ]},
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 26 } },
      plugins: { legend: { display: false }, tooltip: { ...chartTooltip(), filter: i => i.raw !== null && !i.dataset.hidden,
        callbacks: { title: items => { if (!items.length) return ''; try { return new Date(items[0].label + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return items[0].label; } } } } },
      scales: {
        // Month names at month starts; for short ranges a date every week
        x: chartScaleX({ type: 'category', ticks: { color: c.muted, autoSkip: false, maxRotation: 0,
          callback: function (v, i) { const d = new Date(this.getLabelForValue(v) + 'T00:00:00'); if (isNaN(d)) return null;
            if (short) return (i % 7 === 0) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
            return d.getDate() === 1 ? d.toLocaleDateString('en-GB', { month: 'short' }) : null; } } }),
        y: chartScaleY({ position: 'left' }),
        // TSS bars live in the bottom ~16 % of the chart
        y1: { position: 'right', display: false, min: 0, max: maxTss / 0.16, grid: { drawOnChartArea: false } },
      }
    }
  });
}

// PMC overlays: shaded form (TSB) zones behind the lines, and dashed race-day markers
// (No band above +25: it would shade the CTL/ATL lines, which share the axis.)
const TSB_BANDS = [
  { from: 5, to: 25, key: 'tsb' },            // fresh
  { from: -30, to: -10, key: 'ctl' },         // optimal training
  { from: -Infinity, to: -30, key: 'missed' },// high risk
];
function pmcOverlayPlugin(labels) {
  const races = (raceDates || []).filter(r => r.date).map(r => ({ idx: labels.indexOf(r.date), date: r.date, name: r.name || 'Race' })).filter(r => r.idx >= 0);
  const todayIdx = labels.indexOf(localDateKey(new Date()));
  return {
    id: 'pmcOverlay',
    beforeDatasetsDraw(chart) {
      // Form zones: only while Form is shown (subtle 4 % tints)
      if (pmcHidden[2]) return;
      const { ctx, chartArea: a, scales: { y } } = chart;
      if (!a || !y) return;
      const c = C();
      ctx.save();
      for (const b of TSB_BANDS) {
        const top = y.getPixelForValue(Math.min(b.to, y.max)), bottom = y.getPixelForValue(Math.max(b.from, y.min));
        if (bottom <= a.top || top >= a.bottom || bottom <= top) continue;
        ctx.fillStyle = withAlpha(c[b.key], 0.04);
        ctx.fillRect(a.left, Math.max(top, a.top), a.right - a.left, Math.min(bottom, a.bottom) - Math.max(top, a.top));
      }
      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales: { x } } = chart;
      if (!a || !x) return;
      const c = C();
      // Label chip above the plot; returns its [left, right] so chips don't overlap
      const chipBox = (px, text) => { ctx.font = "600 12px 'Geist', system-ui, sans-serif"; const w = ctx.measureText(text).width + 12; const left = Math.min(Math.max(px - w / 2, a.left), a.right - w); return [left, left + w]; };
      const chip = (px, text, bg, fg) => {
        const [left, right] = chipBox(px, text), h = 20;
        ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(left, a.top - h - 4, right - left, h, 6) : ctx.rect(left, a.top - h - 4, right - left, h); ctx.fill();
        ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, left + 6, a.top - h / 2 - 4);
        return [left, right];
      };
      const vline = (px, color, width) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); };
      ctx.save();
      const taken = [];
      for (const r of races) {
        const px = x.getPixelForValue(r.idx);
        if (px < a.left || px > a.right) continue;
        vline(px, c.tss, 1.5);
        const d = parseIsoDate(r.date);
        taken.push(chip(px, `${r.name} · ${d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}`, c.tss, '#0C0D10'));
      }
      if (todayIdx >= 0) {
        const px = x.getPixelForValue(todayIdx);
        if (px >= a.left && px <= a.right) {
          vline(px, withAlpha(c.text, 0.35), 1);
          const [l, r] = chipBox(px, 'Today');
          if (!taken.some(([tl, tr]) => l < tr + 6 && r > tl - 6)) chip(px, 'Today', c.raised, c.dim);
        }
      }
      ctx.restore();
    },
  };
}

function updateForecast() { document.getElementById('displayForecastDays').textContent = `${document.getElementById('sliderForecastDays').value} days`; if (pmcChart) buildPMCChart(); }
// Toggle a PMC series (0 CTL, 1 ATL, 2 TSB, 3 TSS, 4 forecast); remembered across chart rebuilds
function toggleChartDataset(i, btn) {
  pmcHidden[i] = !pmcHidden[i];
  if (btn) {
    btn.setAttribute('aria-pressed', String(!pmcHidden[i]));
    if (i === 4) btn.textContent = pmcHidden[4] ? 'Show forecast' : 'Hide forecast';
  }
  if (pmcChart) buildPMCChart();
}

function setCustomChartRange() {
  const from = document.getElementById('chartRangeFrom').value;
  const to = document.getElementById('chartRangeTo').value;
  if (!from || !to) return;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.toggle('is-active', b.getAttribute('onclick')?.includes('toggleCustomRange')));
  currentRange = { from, to };
  buildPMCChart();
}

function setChartRange(r, btn) {
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  document.getElementById('customRange').hidden = true;
  currentRange = r;
  buildPMCChart();
}

// "Custom" range: reveal the two date inputs (the range applies once both are set)
function toggleCustomRange(btn) {
  const box = document.getElementById('customRange');
  box.hidden = !box.hidden;
  btn.setAttribute('aria-expanded', String(!box.hidden));
  if (!box.hidden) document.getElementById('chartRangeFrom').focus();
}

// ══════════════════════════════════════════════
// Comparison (with mode: range / year / month)
// ══════════════════════════════════════════════
let compareCharts = [];

function destroyCompareCharts() {
  compareCharts.forEach(c => c.destroy());
  compareCharts = [];
  if (compareChart) { compareChart.destroy(); compareChart = null; }
}

function initCompareDefaults() {
  if (!allActivities.length) return;
  const sorted = [...allActivities].sort((a, b) => a.startDate - b.startDate);
  document.getElementById('compareFrom').value = localDateKey(sorted[0].startDate);
  document.getElementById('compareTo').value = localDateKey(new Date());
  const sports = [...new Set(allActivities.map(a => a.sport))].sort();
  document.getElementById('compareSport').innerHTML = '<option value="all">All Sports</option>' + sports.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(fmtSportName(s))}</option>`).join('');
  // Populate year selectors
  const years = [...new Set(allActivities.map(a => a.startDate.getFullYear()))].sort();
  const yearOpts = years.map(y => `<option value="${y}">${y}</option>`).join('');
  const yA = document.getElementById('compareYearA');
  const yB = document.getElementById('compareYearB');
  if (yA && yB) { yA.innerHTML = yearOpts; yB.innerHTML = yearOpts; if (years.length >= 2) { yA.value = years[years.length - 2]; yB.value = years[years.length - 1]; } else if (years.length === 1) { yA.value = years[0]; yB.value = years[0]; } }
  // Populate month selectors (all months that have data)
  const monthSet = new Set();
  allActivities.forEach(a => monthSet.add(localDateKey(a.startDate).slice(0, 7)));
  const months = [...monthSet].sort().reverse();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthOpts = months.map(m => {
    const [y, mo] = m.split('-');
    return `<option value="${m}">${monthNames[parseInt(mo)-1]} ${y}</option>`;
  }).join('');
  const mA = document.getElementById('compareMonthA'), mB = document.getElementById('compareMonthB');
  if (mA) {
    mA.innerHTML = monthOpts;
    // Pre-select second most recent month
    if (months.length >= 2) { mA.options[1].selected = true; }
  }
  if (mB) {
    mB.innerHTML = monthOpts;
    // Pre-select most recent month
    if (months.length >= 1) { mB.options[0].selected = true; }
  }
}

function onCompareModeChange() {
  const mode = document.getElementById('compareMode').value;
  document.getElementById('compareRangeControls').style.display = mode === 'range' ? 'flex' : 'none';
  const yc = document.getElementById('compareYearControls'); if (yc) yc.style.display = mode === 'year' ? 'flex' : 'none';
  const mc = document.getElementById('compareMonthControls'); if (mc) mc.style.display = mode === 'month' ? 'flex' : 'none';
  initCompareDefaults();
  renderComparison();
}

function renderComparison() {
  if (!allActivities.length) return;
  const modeEl = document.getElementById('compareMode');
  const mode = modeEl ? modeEl.value : 'range';
  const grouping = document.getElementById('compareGrouping').value;
  const sportFilter = document.getElementById('compareSport').value;

  if (mode === 'range') {
    const fromStr = document.getElementById('compareFrom').value;
    const toStr = document.getElementById('compareTo').value;
    if (!fromStr || !toStr) return;
    const from = new Date(fromStr + 'T00:00:00'), to = new Date(toStr + 'T23:59:59');
    let filtered = allActivities.filter(a => a.startDate >= from && a.startDate <= to);
    if (sportFilter !== 'all') filtered = filtered.filter(a => a.sport === sportFilter);
    const periods = {};
    for (const a of filtered) {
      const key = getPeriodKey(a.startDate, grouping);
      if (!periods[key]) periods[key] = { label: key, tss: 0, duration: 0, distance: 0, count: 0, hrs: [], ifs: [], powers: [] };
      const p = periods[key]; p.tss += (a.tss || 0); p.duration += (a.duration || 0); p.distance += (a.distance || 0); p.count++;
      if (a.avgHr) p.hrs.push(a.avgHr); if (a.intensityFactor) p.ifs.push(a.intensityFactor);
    }
    const sp = Object.values(periods).sort((a, b) => a.label.localeCompare(b.label));
    renderCompareMetricsRange(sp, grouping);
    renderCompareChartRange(sp, grouping);
  } else {
    let periodsArr;
    if (mode === 'year') {
      const yA = +document.getElementById('compareYearA').value, yB = +document.getElementById('compareYearB').value;
      if (!yA || !yB) return;
      periodsArr = [
        { from: new Date(yA, 0, 1), to: new Date(yA, 11, 31, 23, 59, 59), label: String(yA) },
        { from: new Date(yB, 0, 1), to: new Date(yB, 11, 31, 23, 59, 59), label: String(yB) },
      ];
    } else {
      const selA = document.getElementById('compareMonthA'), selB = document.getElementById('compareMonthB');
      const monthsA = Array.from(selA.selectedOptions).map(o => o.value);
      const monthsB = Array.from(selB.selectedOptions).map(o => o.value);
      if (!monthsA.length || !monthsB.length) return;
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      function monthRange(months) {
        let from = null, to = null;
        for (const m of months) {
          const [y, mo] = m.split('-').map(Number);
          const s = new Date(y, mo-1, 1), e = new Date(y, mo, 0, 23, 59, 59);
          if (!from || s < from) from = s;
          if (!to || e > to) to = e;
        }
        const label = months.length === 1
          ? monthNames[parseInt(months[0].split('-')[1])-1] + ' ' + months[0].split('-')[0]
          : months.length + ' months';
        return { from, to, label };
      }
      const rA = monthRange(monthsA), rB = monthRange(monthsB);
      periodsArr = [
        { from: rA.from, to: rA.to, label: rA.label },
        { from: rB.from, to: rB.to, label: rB.label },
      ];
    }
    const datasets = periodsArr.map(p => {
      let f = allActivities.filter(a => a.startDate >= p.from && a.startDate <= p.to);
      if (sportFilter !== 'all') f = f.filter(a => a.sport === sportFilter);
      return { label: p.label, _from: p.from, _to: p.to, tss: f.reduce((s,a)=>s+(a.tss||0),0), duration: f.reduce((s,a)=>s+(a.duration||0),0), distance: f.reduce((s,a)=>s+(a.distance||0),0), count: f.length, hrs: f.filter(a=>a.avgHr).map(a=>a.avgHr), ifs: f.filter(a=>a.intensityFactor).map(a=>a.intensityFactor) };
    });
    renderCompareMetricsSideBySide(datasets);
    renderCompareChartsSideBySide(datasets);
  }
}

function renderCompareMetricsRange(sp, grouping) {
  const metrics = [
    { label: 'Total TSS', values: sp.map(p => p.tss), fmt: v => v.toLocaleString(), color: 'var(--color-amber)' },
    { label: 'Total Time', values: sp.map(p => p.duration), fmt: v => fmtDuration(v), color: 'var(--color-blue)' },
    { label: 'Total Distance', values: sp.map(p => p.distance), fmt: v => (v/1000).toFixed(1)+' km', color: 'var(--color-green)' },
    { label: 'Activities', values: sp.map(p => p.count), fmt: v => v.toString(), color: 'var(--color-purple)' },
    { label: 'Avg IF', values: sp.map(p => p.ifs.length ? +(p.ifs.reduce((a,b)=>a+b,0)/p.ifs.length).toFixed(2) : 0), fmt: v => v.toFixed(2), color: 'var(--color-cyan)' },
    { label: 'Avg HR', values: sp.map(p => p.hrs.length ? Math.round(p.hrs.reduce((a,b)=>a+b,0)/p.hrs.length) : 0), fmt: v => v+' bpm', color: 'var(--color-red)' },
  ];
  document.getElementById('compareMetrics').innerHTML = metrics.map(m => {
    const vals = m.values, latest = vals.length ? vals[vals.length-1] : 0, prev = vals.length > 1 ? vals[vals.length-2] : 0;
    const delta = prev > 0 ? ((latest-prev)/prev*100) : 0, avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    return `<div class="compare-metric-card"><div class="compare-metric-label">${m.label}</div><div class="compare-period-row"><span class="compare-period-label">Latest</span><span class="compare-period-value" style="color:${m.color}">${m.fmt(latest)}${delta!==0?`<span class="compare-delta ${delta>0?'pos':'neg'}">${delta>0?'+':''}${delta.toFixed(0)}%</span>`:''}</span></div><div class="compare-period-row"><span class="compare-period-label">Previous</span><span class="compare-period-value">${m.fmt(prev)}</span></div><div class="compare-period-row"><span class="compare-period-label">Average</span><span class="compare-period-value" style="color:var(--text-dim)">${m.fmt(Math.round(avg))}</span></div></div>`;
  }).join('');
}

function renderCompareChartRange(sp, grouping) {
  const labels = sp.map(p => formatPeriodLabel(p.label, grouping));
  destroyCompareCharts();
  document.getElementById('compareChartArea').innerHTML = '<canvas id="compareChart"></canvas>';
  compareChart = new Chart(document.getElementById('compareChart').getContext('2d'), {
    type: 'bar', data: { labels, datasets: [
      { label: 'TSS', data: sp.map(p=>p.tss), backgroundColor: 'rgba(245,158,11,0.7)', borderRadius: 4, yAxisID: 'y' },
      { label: 'Hours', data: sp.map(p=>+(p.duration/3600).toFixed(1)), backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4, yAxisID: 'y1' },
    ]}, options: { responsive:true, maintainAspectRatio:false, animation:false, plugins: { legend:{display:true,labels:{color:'#a3a8bc'}}, tooltip:{backgroundColor:'#1e2030',borderColor:'#2a2d3e',borderWidth:1,titleColor:'#e8eaf0',bodyColor:'#a3a8bc',padding:12,cornerRadius:8} }, scales: { x:{grid:{color:'rgba(42,45,62,0.4)'},ticks:{color:'#858aa3',maxRotation:45}}, y:{position:'left',grid:{color:'rgba(42,45,62,0.3)'},ticks:{color:'rgba(245,158,11,0.7)'},title:{display:true,text:'TSS',color:'rgba(245,158,11,0.7)'}}, y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:'rgba(59,130,246,0.7)'},title:{display:true,text:'Hours',color:'rgba(59,130,246,0.7)'},min:0} } }
  });
}

function renderCompareMetricsSideBySide(datasets) {
  const defs = [
    { label:'Total TSS', key:'tss', fmt:v=>v.toLocaleString(), color:'var(--color-amber)' },
    { label:'Total Time', key:'duration', fmt:v=>fmtDuration(v), color:'var(--color-blue)' },
    { label:'Total Distance', key:'distance', fmt:v=>(v/1000).toFixed(1)+' km', color:'var(--color-green)' },
    { label:'Activities', key:'count', fmt:v=>v.toString(), color:'var(--color-purple)' },
    { label:'Avg IF', key:'ifs', fmt:v=>v.toFixed(2), color:'var(--color-cyan)', avg:true },
    { label:'Avg HR', key:'hrs', fmt:v=>Math.round(v)+' bpm', color:'var(--color-red)', avg:true },
  ];
  document.getElementById('compareMetrics').innerHTML = defs.map(m => {
    const vals = datasets.map(ds => m.avg ? (ds[m.key].length ? ds[m.key].reduce((a,b)=>a+b,0)/ds[m.key].length : 0) : ds[m.key]);
    const delta = vals[0] > 0 ? ((vals[1]-vals[0])/vals[0]*100) : 0;
    return `<div class="compare-metric-card"><div class="compare-metric-label">${m.label}</div>${datasets.map((ds,i) => `<div class="compare-period-row"><span class="compare-period-label"><span class="compare-period-dot" style="background:${i===0?'var(--color-blue)':'var(--color-amber)'}"></span>${ds.label}</span><span class="compare-period-value" style="color:${m.color}">${m.fmt(vals[i])}${i===1&&delta!==0?`<span class="compare-delta ${delta>0?'pos':'neg'}">${delta>0?'+':''}${delta.toFixed(0)}%</span>`:''}</span></div>`).join('')}</div>`;
  }).join('');
}

function renderCompareChartsSideBySide(datasets) {
  destroyCompareCharts();
  const calc = document.getElementById('compareCalc') ? document.getElementById('compareCalc').value : 'total';

  if (calc === 'cumulative') {
    renderCumulativeCharts(datasets);
    return;
  }

  const chartDefs = [
    { title:'TSS', data: datasets.map(ds=>ds.tss), color:['rgba(59,130,246,0.7)','rgba(245,158,11,0.7)'] },
    { title:'Hours', data: datasets.map(ds=>+(ds.duration/3600).toFixed(1)), color:['rgba(59,130,246,0.7)','rgba(245,158,11,0.7)'] },
    { title:'Distance (km)', data: datasets.map(ds=>+(ds.distance/1000).toFixed(1)), color:['rgba(59,130,246,0.7)','rgba(245,158,11,0.7)'] },
    { title:'Activities', data: datasets.map(ds=>ds.count), color:['rgba(59,130,246,0.7)','rgba(245,158,11,0.7)'] },
  ];
  const area = document.getElementById('compareChartArea');
  area.innerHTML = '<div class="compare-charts-grid">' + chartDefs.map((_,i) => `<div class="compare-chart-cell"><canvas id="cmpChart${i}"></canvas></div>`).join('') + '</div>';
  chartDefs.forEach((cd, i) => {
    const c = new Chart(document.getElementById('cmpChart'+i).getContext('2d'), {
      type: 'bar', data: { labels: datasets.map(ds=>ds.label), datasets: [{ data: cd.data, backgroundColor: cd.color, borderRadius: 6, barPercentage: 0.6 }] },
      options: { responsive:true, maintainAspectRatio:false, animation:false, plugins: { legend:{display:false}, title:{display:true,text:cd.title,color:'#e8eaf0',font:{size:14,family:'DM Sans',weight:600},padding:{bottom:12}}, tooltip:{backgroundColor:'#1e2030',borderColor:'#2a2d3e',borderWidth:1,titleColor:'#e8eaf0',bodyColor:'#a3a8bc',padding:12,cornerRadius:8} }, scales: { x:{grid:{color:'rgba(42,45,62,0.4)'},ticks:{color:'#a3a8bc',font:{size:12}}}, y:{grid:{color:'rgba(42,45,62,0.3)'},ticks:{color:'#858aa3'},beginAtZero:true} } }
    });
    compareCharts.push(c);
  });
}

function renderCumulativeCharts(datasets) {
  destroyCompareCharts();
  const colors = ['#3b82f6', '#f59e0b'];
  const metricDefs = [
    { title: 'Cumulative TSS', key: 'tss', extract: a => a.tss || 0 },
    { title: 'Cumulative Hours', key: 'duration', extract: a => (a.duration || 0) / 3600 },
    { title: 'Cumulative Distance (km)', key: 'distance', extract: a => (a.distance || 0) / 1000 },
    { title: 'Cumulative Activities', key: 'count', extract: a => 1 },
  ];
  const sportFilter = document.getElementById('compareSport').value;
  const area = document.getElementById('compareChartArea');
  area.innerHTML = '<div class="compare-charts-grid">' + metricDefs.map((_,i) => `<div class="compare-chart-cell"><canvas id="cmpChart${i}"></canvas></div>`).join('') + '</div>';

  metricDefs.forEach((md, mi) => {
    const chartDatasets = datasets.map((ds, di) => {
      // Get activities for this period, sorted by date
      let acts = allActivities.filter(a => a.startDate >= ds._from && a.startDate <= ds._to);
      if (sportFilter !== 'all') acts = acts.filter(a => a.sport === sportFilter);
      acts.sort((a, b) => a.startDate - b.startDate);
      // Build cumulative series — use day offset from period start
      let cum = 0;
      const points = [{ x: 0, y: 0 }];
      for (const a of acts) {
        cum += md.extract(a);
        const dayOffset = Math.floor((a.startDate - ds._from) / 86400000);
        points.push({ x: dayOffset, y: +cum.toFixed(1) });
      }
      return {
        label: ds.label,
        data: points,
        borderColor: colors[di],
        backgroundColor: colors[di] + '18',
        borderWidth: 2.5,
        pointRadius: 0,
        pointHitRadius: 6,
        tension: 0.2,
        fill: true,
      };
    });
    const maxDays = Math.max(...chartDatasets.flatMap(ds => ds.data.map(p => p.x)), 1);
    const c = new Chart(document.getElementById('cmpChart'+mi).getContext('2d'), {
      type: 'line',
      data: { datasets: chartDatasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: true, labels: { color: '#a3a8bc', usePointStyle: true, pointStyle: 'line' } },
          title: { display: true, text: md.title, color: '#e8eaf0', font: { size: 14, family: 'DM Sans', weight: 600 }, padding: { bottom: 12 } },
          tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#a3a8bc', padding: 12, cornerRadius: 8 }
        },
        scales: {
          x: { type: 'linear', min: 0, max: maxDays, grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#858aa3', callback: v => 'Day ' + v }, title: { display: true, text: 'Days into period', color: '#858aa3' } },
          y: { grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#858aa3' }, beginAtZero: true }
        }
      }
    });
    compareCharts.push(c);
  });
}

function getPeriodKey(date, g) { const d = new Date(date); if (g === 'year') return d.getFullYear().toString(); if (g === 'month') return localDateKey(d).slice(0, 7); const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7); const w1 = new Date(t.getFullYear(), 0, 4); const wn = 1 + Math.round(((t - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7); return `${t.getFullYear()}-W${String(wn).padStart(2, '0')}`; }
function formatPeriodLabel(key, g) { if (g === 'year') return key; if (g === 'month') { const [y, m] = key.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m) - 1] + ' ' + y; } return key; }

// ══════════════════════════════════════════════
// Planner
// ══════════════════════════════════════════════
function initPlanner() {
  if (plannerInited) { updatePlannerForecast(); return; }
  plannerInited = true;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dow = now.getDay(), daysToMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  const startMon = addDays(now, daysToMon);
  plannerData = [];
  for (let w = 0; w < 26; w++) {
    const ws = addDays(startMon, w * 7);
    const we = addDays(ws, 6);
    plannerData.push({ weekStart: ws, weekLabel: `${ws.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${we.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, monthLabel: ws.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), tss: 0 });
  }
  // Restore saved planner data by week start date (not position), so plans don't shift as weeks pass
  if (savedPlannerWeeks && savedPlannerWeeks.length) {
    const tssByWeek = {};
    for (const w of savedPlannerWeeks) {
      const d = new Date(w.weekStart);
      if (isNaN(d)) continue;
      // Round to the nearest local midnight: older saves could be an hour off across DST
      tssByWeek[localDateKey(new Date(d.getTime() + 12 * 3600000))] = w.tss || 0;
    }
    for (const p of plannerData) p.tss = tssByWeek[localDateKey(p.weekStart)] || 0;
  }
  renderPlannerGrid(); updatePlannerForecast();
  if (typeof renderRaceTargetForm === 'function') renderRaceTargetForm();
  // Auto-populate from plan if planner is empty
  const allZero = plannerData.every(p => p.tss === 0);
  if (allZero && trainingPlan && trainingPlan.weeks && trainingPlan.weeks.length) {
    populatePlannerFromPlan();
  }
}

function renderPlannerGrid() {
  const g = document.getElementById('plannerGrid');
  let h = '<div class="planner-header-cell">Week</div><div class="planner-header-cell">Dates</div><div class="planner-header-cell">Weekly TSS</div><div class="planner-header-cell">Daily Avg</div><div class="planner-header-cell">Zone</div>';
  let cm = '';
  for (let i = 0; i < plannerData.length; i++) {
    const p = plannerData[i]; if (p.monthLabel !== cm) { cm = p.monthLabel; h += `<div class="planner-month-divider">${cm}</div>`; }
    const da = p.tss > 0 ? Math.round(p.tss / 7) : 0, z = getTrainingZone(p.tss);
    h += `<div class="planner-week-label">W${i + 1}</div><div class="planner-cell" style="font-size:12px;color:var(--text-dim)">${p.weekLabel}</div><div class="planner-cell"><input type="number" class="planner-input ${p.tss > 0 ? 'has-value' : ''}" value="${p.tss || ''}" min="0" max="2000" placeholder="0" data-week="${i}" onchange="updatePlannerWeek(${i},this.value)" oninput="this.classList.toggle('has-value',this.value>0)"></div><div class="planner-cell"><span class="cell-mono" style="color:var(--text-dim)">${da}</span></div><div class="planner-cell"><span style="font-size:12px;font-weight:600;color:${z.color}">${z.label}</span></div>`;
  }
  g.innerHTML = h;
}

function getTrainingZone(tss) { if (tss <= 0) return { label: '—', color: 'var(--text-muted)' }; if (tss < 200) return { label: 'Recovery', color: 'var(--color-green)' }; if (tss < 400) return { label: 'Endurance', color: 'var(--color-blue)' }; if (tss < 600) return { label: 'Tempo', color: 'var(--color-amber)' }; if (tss < 800) return { label: 'Threshold', color: '#f97316' }; return { label: 'Overreach', color: 'var(--color-red)' }; }

function updatePlannerWeek(idx, val) {
  plannerData[idx].tss = Math.max(0, parseInt(val) || 0);
  renderPlannerGrid(); updatePlannerForecast();
  // Auto-save to Firebase
  if (typeof savePlannerData === 'function') savePlannerData();
}

function populatePlannerFromPlan() {
  if (!trainingPlan || !trainingPlan.weeks || !trainingPlan.weeks.length) {
    showToast('No training plan loaded — import one in the Plan tab first', '⚠️');
    return;
  }
  // Match plan weeks to planner weeks by date overlap or by index
  const planWeeks = trainingPlan.weeks;
  for (const pw of plannerData) {
    pw.tss = 0; // Reset
  }
  // Try to match by date: parse plan week dates like "Feb 23 – Mar 1"
  for (const pw of planWeeks) {
    const weekTss = pw.tss || 0;
    // Find the planner week that best matches this plan week
    // Try parsing the dates string
    let matched = false;
    const startDate = planWeekStart(pw, trainingPlan);
    if (startDate) {
      // Find closest planner week
      let bestIdx = -1, bestDiff = Infinity;
      for (let i = 0; i < plannerData.length; i++) {
        const diff = Math.abs(plannerData[i].weekStart - startDate);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      }
      if (bestIdx >= 0 && bestDiff < 7 * 86400000) {
        plannerData[bestIdx].tss = weekTss;
        matched = true;
      }
    }
    if (!matched) {
      // Fallback: use week index
      const idx = pw.week - 1;
      if (idx >= 0 && idx < plannerData.length) {
        plannerData[idx].tss = weekTss;
      }
    }
  }
  renderPlannerGrid();
  updatePlannerForecast();
  if (typeof savePlannerData === 'function') savePlannerData();
  showToast('Planner populated from training plan', '✅');
}

function plannerPreset(type) {
  const ct = pmcResult.lastCtl ? Math.round(pmcResult.lastCtl * 7) : 350;
  switch (type) {
    case 'fromplan': populatePlannerFromPlan(); return;
    case 'maintain': plannerData.forEach(p => p.tss = ct); break;
    case 'build': plannerData.forEach((p, i) => { const bl = Math.floor(i / 4), wk = i % 4, base = ct + bl * 40; p.tss = wk === 3 ? Math.round(base * 0.6) : Math.round(base + wk * 20); }); break;
    case 'taper': plannerData.forEach((p, i) => p.tss = Math.round(ct * Math.pow(0.92, i))); break;
    case 'polarized': plannerData.forEach((p, i) => { const w = i % 3; p.tss = w === 0 ? Math.round(ct * 1.3) : w === 1 ? Math.round(ct * 0.7) : Math.round(ct * 1.1); }); break;
    case 'clear': plannerData.forEach(p => p.tss = 0); break;
  }
  renderPlannerGrid(); updatePlannerForecast();
  if (typeof savePlannerData === 'function') savePlannerData();
}


function addRaceDate(dateStr, name) {
  raceDates.push({ date: dateStr || '', name: name || '' });
  renderRaceDateInputs();
  updatePlannerForecast();
  saveRaceDates();
}

function removeRaceDate(idx) {
  raceDates.splice(idx, 1);
  renderRaceDateInputs();
  updatePlannerForecast();
  saveRaceDates();
}

function updateRaceDate(idx, field, value) {
  raceDates[idx][field] = value;
  if (typeof renderRaceTargetForm === 'function') renderRaceTargetForm();
  updatePlannerForecast();
  saveRaceDates();
}

function renderRaceDateInputs() {
  const container = document.getElementById('raceDateInputs');
  if (!container) return;
  if (typeof renderRaceTargetForm === 'function') renderRaceTargetForm();
  container.innerHTML = raceDates.map((r, i) => `
    <div style="display:flex;align-items:center;gap:4px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px;padding:4px 8px">
      <input type="date" class="compare-date-input" value="${escapeHtml(r.date)}" onchange="updateRaceDate(${i},'date',this.value)" style="font-size:12px;padding:3px 6px">
      <input type="text" class="settings-input" value="${escapeHtml(r.name)}" placeholder="Race name" onchange="updateRaceDate(${i},'name',this.value)" style="font-size:12px;padding:3px 6px;width:120px;margin:0">
      <button onclick="removeRaceDate(${i})" style="background:none;border:none;color:var(--color-red);cursor:pointer;font-size:14px;padding:2px 4px" title="Remove">✕</button>
    </div>
  `).join('');
}

function saveRaceDates() {
  if (typeof saveRaceDatesData === 'function') saveRaceDatesData(raceDates);
}

async function loadRaceDates() {
  if (typeof loadRaceDatesData !== 'function') return;
  const saved = await loadRaceDatesData();
  if (saved) { raceDates = saved; renderRaceDateInputs(); renderTodayHead(); }
}

function updatePlannerForecast() {
  let ctl = pmcResult.lastCtl || 0, atl = pmcResult.lastAtl || 0;
  const labels = ['Today'], ctlV = [+ctl.toFixed(1)], atlV = [+atl.toFixed(1)], tsbV = [+(ctl - atl).toFixed(1)];
  for (const week of plannerData) { const dt = week.tss / 7; for (let d = 0; d < 7; d++) { ctl += (dt - ctl) / 42; atl += (dt - atl) / 7; } labels.push(week.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })); ctlV.push(+ctl.toFixed(1)); atlV.push(+atl.toFixed(1)); tsbV.push(+(ctl - atl).toFixed(1)); }
  document.getElementById('planCtl').textContent = ctl.toFixed(1);
  document.getElementById('planAtl').textContent = atl.toFixed(1);
  const tsb = ctl - atl; document.getElementById('planTsb').textContent = tsb.toFixed(1); document.getElementById('planTsb').style.color = tsb >= 0 ? 'var(--color-green)' : 'var(--color-red)';
  // Build race date markers — find label indices
  const raceMarkers = [];
  for (const rd of raceDates) {
    if (!rd.date) continue;
    const raceDate = new Date(rd.date + 'T00:00:00');
    // Find closest label
    let bestIdx = -1, bestDiff = Infinity;
    for (let li = 0; li < labels.length; li++) {
      // labels are formatted dates like "3 Mar", need to compare with weekStart dates
      if (li === 0) {
        const diff = Math.abs(new Date() - raceDate);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = li; }
      } else if (li - 1 < plannerData.length) {
        const diff = Math.abs(plannerData[li - 1].weekStart - raceDate);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = li; }
      }
    }
    if (bestIdx >= 0) raceMarkers.push({ idx: bestIdx, name: rd.name || 'Race', date: rd.date });
  }

  // Custom plugin to draw vertical race lines
  const raceLinePlugin = {
    id: 'raceLines',
    afterDraw(chart) {
      const ctx = chart.ctx;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      for (const rm of raceMarkers) {
        const x = xScale.getPixelForValue(rm.idx);
        if (x < xScale.left || x > xScale.right) continue;
        // Vertical dashed line
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.moveTo(x, yScale.top);
        ctx.lineTo(x, yScale.bottom);
        ctx.stroke();
        // Race flag + label
        ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 12px DM Sans';
        ctx.textAlign = 'center';
        ctx.fillText('🏁 ' + rm.name, x, yScale.top - 8);
        // Date below
        ctx.fillStyle = '#a3a8bc';
        ctx.font = '11px JetBrains Mono';
        ctx.fillText(rm.date, x, yScale.top - 22);
        ctx.restore();
      }
    }
  };

  if (plannerChart) plannerChart.destroy();
  plannerChart = new Chart(document.getElementById('plannerChart').getContext('2d'), {
    type: 'line',
    plugins: [raceLinePlugin],
    data: { labels, datasets: [
      { label: 'CTL (Fitness)', data: ctlV, borderColor: '#3b82f6', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#3b82f6', tension: 0.3, fill: false },
      { label: 'ATL (Fatigue)', data: atlV, borderColor: '#f43f5e', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#f43f5e', tension: 0.3, fill: false },
      { label: 'TSB (Form)', data: tsbV, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 1.5, pointRadius: 3, pointBackgroundColor: '#10b981', tension: 0.3, fill: true },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 35 } },
      plugins: {
        legend: { display: true, labels: { color: '#a3a8bc', usePointStyle: true, pointStyle: 'line' } },
        tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#a3a8bc', padding: 12, cornerRadius: 8 }
      },
      scales: {
        x: { grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#858aa3', maxRotation: 45 } },
        y: { grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#858aa3' }, title: { display: true, text: 'CTL / ATL / TSB', color: '#858aa3' } }
      }
    }
  });
}

// ══════════════════════════════════════════════
// Training Table
// ══════════════════════════════════════════════
function renderTrainingTable() {
  const sorted = [...allActivities].sort((a, b) => { const k = sortConfig.key; let va, vb; if (k === 'date') { va = a.startDate?.getTime() || 0; vb = b.startDate?.getTime() || 0; } else if (k === 'sport' || k === 'name') { va = a[k] || ''; vb = b[k] || ''; } else { va = a[k] || 0; vb = b[k] || 0; } if (typeof va === 'string') return sortConfig.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); return sortConfig.dir === 'asc' ? va - vb : vb - va; });
  // Search (name or sport) + sport filter chips
  const q = (document.getElementById('logSearch')?.value || '').trim().toLowerCase();
  const rows = sorted.map((a, idx) => ({ a, aid: a.id || ('local-' + idx) })).filter(({ a }) =>
    (logFilter === 'all' || sportKey(a.sport) === logFilter) &&
    (!q || `${a.name || ''} ${fmtSportName(a.sport)}`.toLowerCase().includes(q)));

  document.getElementById('tableBody').innerHTML = rows.map(({ a, aid }) => {
    const checked = selectedActivityIds.has(aid) ? 'checked' : '';
    const check = selectMode ? `<input type="checkbox" class="row-checkbox" data-id="${escapeHtml(aid)}" ${checked} onchange="onRowSelect(this)" aria-label="Select ${escapeHtml(a.name || 'activity')}">` : '';
    const name = a.id ? `<button class="btn-reset activity-link" data-id="${escapeHtml(a.id)}" onclick="openActivityDetail(this.dataset.id)">${escapeHtml(a.name || fmtSportName(a.sport))}</button>` : escapeHtml(a.name || '—');
    return `<tr class="${checked ? 'row-selected' : ''}"><td class="col-check">${check}</td><td>${fmtDate(a.startDate)}</td><td class="cell-name">${name}</td><td><span class="sport-label">${sportDot(a.sport)}${escapeHtml(sportLabel(a.sport))}</span></td><td class="num">${fmtDuration(a.duration)}</td><td class="num">${fmtDist(a.distance, a.sport)}</td><td class="num cell-tss">${a.tss || '—'}</td><td class="num">${a.intensityFactor ? a.intensityFactor.toFixed(2) : '—'}</td><td class="num">${a.avgHr ? a.avgHr + ' bpm' : '—'}</td><td class="num">${a.avgPower ? a.avgPower + ' W' : '—'}</td><td class="num">${a.calories ? a.calories.toLocaleString('en-GB') : '—'}</td></tr>`;
  }).join('');

  const list = document.getElementById('logList');
  if (list) list.innerHTML = logListHtml(rows);

  const n = allActivities.length, word = x => `activit${x === 1 ? 'y' : 'ies'}`;
  document.getElementById('activityCount').textContent = rows.length === n ? `${n} ${word(n)}` : `${rows.length} of ${n} ${word(n)}`;
  document.querySelectorAll('.training-table th').forEach(th => { const ok = th.dataset.col === sortConfig.key; th.classList.toggle('is-sorted', ok); const ar = th.querySelector('.sort-indicator'); if (ar) ar.textContent = (ok && sortConfig.dir === 'asc') ? '▲' : '▼'; });
}

// Phone list: grouped by week when sorted by date ("W39 · 21 – 27 Sept" + summary), one card of rows per group
function logListHtml(rows) {
  if (!rows.length) return `<div class="empty-state card"><div class="empty-state__title">No activities</div><div class="empty-state__text">${allActivities.length ? 'Nothing matches this search or filter.' : 'Activities synced from Strava appear here.'}</div></div>`;
  const groups = [];
  if (sortConfig.key === 'date') {
    for (const r of rows) {
      const d = r.a.startDate instanceof Date && !isNaN(r.a.startDate) ? r.a.startDate : null;
      const mon = d ? addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7)) : null;
      const key = mon ? localDateKey(mon) : '';
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) groups.push(g = { key, mon, rows: [] });
      g.rows.push(r);
    }
  } else groups.push({ key: 'all', mon: null, rows });
  const now = new Date(), thisWeek = localDateKey(addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -((now.getDay() + 6) % 7)));

  return groups.map(g => {
    let head = '';
    if (g.key !== 'all') {
      const secs = g.rows.reduce((t, r) => t + (r.a.duration || 0), 0), tss = g.rows.reduce((t, r) => t + (r.a.tss || 0), 0);
      const meta = `${g.rows.length} ${g.rows.length === 1 ? 'activity' : 'activities'} · ${fmtMinutes(Math.round(secs / 60))} · TSS ${Math.round(tss)}`;
      const title = !g.mon ? 'Undated' : g.key === thisWeek ? 'This week' : logWeekTitle(g.mon);
      head = `<div class="log-group__head"><div class="log-group__title">${escapeHtml(title)}</div><div class="log-group__meta">${meta}</div></div>`;
    }
    return `<section class="log-group">${head}<div class="log-rows">${g.rows.map(logRowHtml).join('')}</div></section>`;
  }).join('');
}

function logWeekTitle(mon) {
  const sun = addDays(mon, 6);
  const pw = trainingPlan && (trainingPlan.weeks || []).find(w => { const st = planWeekStart(w, trainingPlan); return st && localDateKey(st) === localDateKey(mon); });
  // ISO week number (Thursday of the week decides the year)
  const thu = addDays(mon, 3), jan4 = new Date(thu.getFullYear(), 0, 4);
  const iso = 1 + Math.round((thu - addDays(jan4, -((jan4.getDay() + 6) % 7))) / 604800000);
  const range = `${mon.getDate()}${mon.getMonth() !== sun.getMonth() ? ' ' + mon.toLocaleDateString('en-GB', { month: 'short' }) : ''} – ${sun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  return `W${String(pw ? pw.week : iso).padStart(2, '0')} · ${range}`;
}

function logRowHtml({ a, aid }) {
  const k = sportKey(a.sport), hasDist = a.distance > 0 && ['run', 'bike', 'swim'].includes(k);
  const mins = a.duration > 0 ? fmtMinutes(Math.round(a.duration / 60)) : '—';
  const primary = hasDist ? `${(a.distance / 1000).toFixed(1)} km` : mins;
  const secondary = `${hasDist ? escapeHtml(mins) : '—'} · <span class="log-row__tss">${a.tss ? escapeHtml(a.tss) : '—'}</span>`;
  const date = a.startDate instanceof Date && !isNaN(a.startDate) ? a.startDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
  const body = `<span class="log-row__main"><span class="log-row__name">${escapeHtml(a.name || fmtSportName(a.sport))}</span><span class="log-row__date">${date}</span></span><span class="log-row__right"><span class="log-row__primary">${escapeHtml(primary)}</span><span class="log-row__secondary">${secondary}</span></span>`;
  if (selectMode) {
    const checked = selectedActivityIds.has(aid);
    return `<label class="log-row${checked ? ' row-selected' : ''}"><span class="log-row__tile"><input type="checkbox" class="row-checkbox" data-id="${escapeHtml(aid)}" ${checked ? 'checked' : ''} onchange="onRowSelect(this)"></span>${body}</label>`;
  }
  const tile = `<span class="log-row__tile" style="color:var(--sport-${k})">${sportIcon(a.sport)}</span>`;
  return a.id ? `<button class="btn-reset log-row" data-id="${escapeHtml(a.id)}" onclick="openActivityDetail(this.dataset.id)">${tile}${body}</button>` : `<div class="log-row">${tile}${body}</div>`;
}
function sortColumn(k) { sortConfig = { key: k, dir: (sortConfig.key === k && sortConfig.dir === 'desc') ? 'asc' : 'desc' }; renderTrainingTable(); }

// ══════════════════════════════════════════════
// Activity Selection & Delete
// ══════════════════════════════════════════════
let selectedActivityIds = new Set();

function onRowSelect(cb) {
  const id = cb.dataset.id;
  if (cb.checked) selectedActivityIds.add(id); else selectedActivityIds.delete(id);
  // The phone list and the desktop table both carry a checkbox per activity: keep them in step
  document.querySelectorAll('.row-checkbox').forEach(x => { if (x.dataset.id !== id) return; x.checked = cb.checked; x.closest('tr, .log-row')?.classList.toggle('row-selected', cb.checked); });
  updateSelectionUI();
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.checked = checked;
    const id = cb.dataset.id;
    if (checked) selectedActivityIds.add(id); else selectedActivityIds.delete(id);
    cb.closest('tr, .log-row')?.classList.toggle('row-selected', checked);
  });
  updateSelectionUI();
}

// Activities: "Select" enters multi-select (checkboxes + delete bar)
function toggleSelectMode(force) {
  selectMode = typeof force === 'boolean' ? force : !selectMode;
  if (!selectMode) selectedActivityIds.clear();
  document.getElementById('tab-log').classList.toggle('select-mode', selectMode);
  document.getElementById('selectBar').hidden = !selectMode;
  const b = document.getElementById('btnSelectMode');
  b.textContent = selectMode ? 'Done' : 'Select';
  b.setAttribute('aria-pressed', String(selectMode));
  renderTrainingTable();
  updateSelectionUI();
}

function setLogFilter(f) {
  logFilter = f;
  document.querySelectorAll('#logFilters .chip').forEach(c => c.classList.toggle('is-active', c.dataset.filter === f));
  renderTrainingTable();
}

function updateSelectionUI() {
  const n = selectedActivityIds.size;
  const sc = document.getElementById('selectedCount');
  const bd = document.getElementById('btnDeleteSelected');
  if (sc) sc.textContent = n + ' selected';
  if (bd) bd.style.display = n > 0 ? 'inline-flex' : 'none';
  const selectAll = document.getElementById('selectAllCheckbox');
  if (selectAll) {
    const total = new Set([...document.querySelectorAll('.row-checkbox')].map(cb => cb.dataset.id)).size;
    selectAll.checked = total > 0 && n === total;
    selectAll.indeterminate = n > 0 && n < total;
  }
}

async function deleteSelectedActivities() {
  const n = selectedActivityIds.size;
  if (!n || !confirm('Delete ' + n + ' activit' + (n > 1 ? 'ies' : 'y') + '? This cannot be undone.')) return;
  const ids = [...selectedActivityIds];
  const remoteIds = ids.filter(id => id && !id.startsWith('local-'));
  if (remoteIds.length && typeof deleteActivities === 'function' && currentUser) {
    // Only remove from the screen once Firestore confirms, so nothing reappears on reload
    if (!(await deleteActivities(remoteIds))) { showToast('Delete failed — nothing was removed', '❌'); return; }
  }
  const toRemove = new Set(ids);
  allActivities = allActivities.filter(a => !toRemove.has(a.id));
  selectedActivityIds.clear();
  updateSelectionUI();
  showToast('Deleted ' + n + ' activit' + (n > 1 ? 'ies' : 'y'), '🗑');
  refreshDashboard();
}


// ══════════════════════════════════════════════
// Formatters
// ══════════════════════════════════════════════
function fmtDate(d) { if (!d || !(d instanceof Date) || isNaN(d)) return '—'; return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function fmtDuration(s) { if (!s || s <= 0) return '—'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60); return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(sec).padStart(2, '0')}s`; }
function fmtDist(m, sport) { if (!m || m <= 0) return '—'; if (sport === 'swimming') return `${m}m`; return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m}m`; }
function fmtSportName(s) { return (s || 'other').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function sportTagClass(s) { if (isCyc(s)) return 'cycling'; if (isRun(s)) return 'running'; if (s === 'swimming') return 'swimming'; return 'other'; }
// Sport icon (SVG from the sprite in index.html) for activity sports and plan sports
function sportIcon(s) {
  const id = isCyc(s) || s === 'bike' ? 'bike' : ['running', 'trail_running', 'run'].includes(s) ? 'run' : ['walking', 'hiking'].includes(s) ? 'walk'
    : s === 'swimming' || s === 'swim' ? 'swim' : ['strength', 'strength+swim', 'fitness_equipment'].includes(s) ? 'strength'
    : s === 'rest' ? 'rest' : s === 'race' ? 'race' : 'other';
  return `<svg class="icon icon-sport icon-${id}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
}
function sportEmoji(s) { return sportIcon(s); }

// ══════════════════════════════════════════════
// File Handling (with Firebase persistence)
// ══════════════════════════════════════════════
async function handleFiles(fileList) {
  let n = 0;
  for (const file of Array.from(fileList)) {
    if (!file.name.toLowerCase().endsWith('.fit')) { showToast(`Skipped ${file.name}`, '⚠️'); continue; }
    try {
      log(`\n[FIT] ── ${file.name} (${(file.size / 1024).toFixed(1)} KB) ──`, 'info');
      const buf = await file.arrayBuffer();
      const parsed = parseFitFile(buf);
      const tssInfo = computeTSS(parsed);
      const act = { ...parsed, tss: tssInfo.tss, intensityFactor: tssInfo.intensityFactor, fileName: file.name };
      const isDup = allActivities.some(a => Math.abs(a.startDate.getTime() - act.startDate.getTime()) < 60000 && a.sport === act.sport);
      if (!isDup) {
        // Save to Firebase
        if (typeof saveActivity === 'function' && currentUser) {
          const docId = await saveActivity(act);
          act.id = docId;
        }
        allActivities.push(act);
        n++;
        log(`  ✓ ${act.sport} ${fmtDate(act.startDate)} TSS=${act.tss}`, 'ok');
      } else log(`  ✗ Duplicate`, 'err');
    } catch (e) { console.error(e); log(`  ✗ ${e.message}`, 'err'); showToast(`Error: ${file.name}`, '❌'); }
  }
  if (n > 0) { showToast(`Imported ${n} activit${n > 1 ? 'ies' : 'y'}`, '✅'); refreshDashboard(); }
}

// Safari: create the file input on demand (hidden inputs in hidden tabs don't fire onchange)
function triggerFitUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.fit';
  input.multiple = true;
  input.onchange = function() { handleFiles(this.files); };
  input.click();
}

// Empty-state call to action: connect Strava, or sync if already connected
function emptyStateStrava() {
  if (typeof stravaTokens !== 'undefined' && stravaTokens && stravaTokens.access_token) syncStravaActivities();
  else stravaConnect();
}

// Tabs are always available once signed in; the Overview shows the empty state until there is data
function setDashboardVisibility(has) {
  document.getElementById('dashboardSection').style.display = 'block';
  document.getElementById('uploadDropzone').style.display = has ? 'none' : 'block';
  document.getElementById('overviewContent').style.display = has ? '' : 'none';
  document.getElementById('dangerZone').style.display = has ? 'flex' : 'none';
}

function refreshDashboard() {
  const has = allActivities.length > 0;
  setDashboardVisibility(has);
  renderTrainingTable();
  renderTodayHead();
  if (has) { computePMC(); buildPMCChart(); initCompareDefaults(); renderSportFitness(); }
  if (typeof renderInsights === 'function') renderInsights();
  if (typeof renderReadiness === 'function' && activitiesLoaded) renderReadiness();
  // Plan vs actual depends on activities
  if (trainingPlan) renderTrainingPlan();
  // Plan, ZWO files, race dates and Strava tokens only need loading once per session
  if (!sessionDataLoaded && currentUser) {
    sessionDataLoaded = true;
    loadSavedPlan();
    if (typeof loadStravaTokens === 'function' && !stravaTokens) loadStravaTokens(); // then auto-syncs
    else if (typeof maybeAutoSync === 'function') maybeAutoSync();                  // tokens from the OAuth callback
  }
}

function recalcAll() {
  const changed = recomputeAllTss();
  refreshDashboard();
  if (typeof saveSettings === 'function') saveSettings();
  // Persist recalculated TSS so it survives a reload
  if (changed.length && typeof updateActivitiesTss === 'function') updateActivitiesTss(changed);
}

async function clearAll() {
  const n = allActivities.length;
  if (!confirm(`Permanently delete all ${n} activities from your account?\n\nStrava activities can be re-imported afterwards with "Sync Strava".`)) return;
  if (typeof deleteAllActivities === 'function' && currentUser) {
    if (!(await deleteAllActivities())) { showToast('Delete failed — your activities were not removed', '❌'); return; }
  }
  allActivities = []; pmcResult = {}; plannerInited = false;
  selectedActivityIds.clear();
  if (pmcChart) { pmcChart.destroy(); pmcChart = null; }
  if (compareChart) { compareChart.destroy(); compareChart = null; }
  if (plannerChart) { plannerChart.destroy(); plannerChart = null; }
  document.getElementById('debugPanel').innerHTML = '';
  refreshDashboard();
  showToast(`Deleted ${n} activities`, '🗑');
}

// Drag & Drop
function onDragOver(e) { e.preventDefault(); const el = document.getElementById('uploadDropzone'); el.classList.add('drag-active'); }
function onDragLeave(e) { e.preventDefault(); const el = document.getElementById('uploadDropzone'); el.classList.remove('drag-active'); }
function onDrop(e) { e.preventDefault(); const el = document.getElementById('uploadDropzone'); el.classList.remove('drag-active'); handleFiles(e.dataTransfer.files); }

// UI
function toggleSettings() {
  const dlg = document.getElementById('settingsDialog');
  if (dlg.open) dlg.close(); else dlg.showModal();
  document.getElementById('btnSettings')?.setAttribute('aria-expanded', String(dlg.open));
}

// ── Account menu ──
function toggleAccountMenu() {
  const menu = document.getElementById('accountMenu');
  const open = menu.classList.toggle('is-open');
  document.getElementById('btnAccount').setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('.account-menu-item')?.focus();
}
function closeAccountMenu() {
  document.getElementById('accountMenu').classList.remove('is-open');
  document.getElementById('btnAccount').setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', e => {
  if (!e.target.closest('[data-account-trigger], #accountMenu')) closeAccountMenu();
  // Close open dropdown menus (<details class="menu">, chip popovers) when clicking elsewhere
  document.querySelectorAll('details.menu[open], details.chip-popover[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('accountMenu')?.classList.contains('is-open')) {
    closeAccountMenu();
    document.getElementById('btnAccount').focus();
  }
});
function toggleDebug() { document.getElementById('debugPanel').classList.toggle('is-open'); }
// Toast with a glyph by type. `kind` is 'ok' | 'error' | 'warn' | 'info' (older callers pass an emoji: mapped)
const TOAST_KINDS = { '✅': 'ok', '❌': 'error', '⚠️': 'warn', '🗑': 'ok', '📅': 'ok' };
function showToast(msg, kind = 'info') {
  const type = TOAST_KINDS[kind] || (['ok', 'error', 'warn', 'info'].includes(kind) ? kind : 'info');
  const el = document.createElement('div');
  el.className = `toast-notification toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const g = document.createElement('span');
  g.className = 'toast-glyph';
  g.setAttribute('aria-hidden', 'true');
  g.textContent = { ok: '✓', error: '✕', warn: '!', info: 'i' }[type];
  el.append(g, msg);
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2800);
  setTimeout(() => el.remove(), 3200);
}


// ══════════════════════════════════════════════
// Training Plan
// ══════════════════════════════════════════════
let trainingPlan = null;
let planCompletions = {};
let zwoFiles = {};

function triggerPlanImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function() { importPlanJson(this.files); };
  input.click();
}

function triggerZwoImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zwo';
  input.multiple = true;
  input.onchange = function() { importZwoFiles(this.files); };
  input.click();
}

function importPlanJson(fileList) {
  const file = fileList[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => applyImportedPlan(e.target.result, file.name);
  reader.onerror = () => showPlanImportStatus('error', `Could not read ${file.name}`, [String(reader.error || 'Unknown read error')]);
  reader.readAsText(file);
}

// Validate, normalise, show and save an imported plan. Never fails silently: every outcome
// is reported in the Plan tab status panel. Returns true when the plan was applied.
async function applyImportedPlan(text, fileName) {
  let result;
  try { result = normalizePlan(text); }
  catch (err) { result = { plan: null, errors: [`Unexpected error while reading the plan: ${err.message}`], warnings: [] }; }

  if (result.errors.length) {
    // Keep the current plan; explain exactly what is wrong
    showPlanImportStatus('error', `Import failed: ${fileName || 'plan'} was not imported`, result.errors);
    showToast('Plan import failed — see the Plan tab', '❌');
    return false;
  }

  trainingPlan = result.plan;
  try { renderTrainingPlan(); }
  catch (err) {
    console.error('Plan render error:', err);
    showPlanImportStatus('error', 'The plan was read but could not be displayed', [err.message]);
    return false;
  }

  // Auto-add the race date from the plan if none is set yet
  if (raceDates.length === 0) {
    const iso = parseIsoDate(trainingPlan.raceDate);
    let date = iso ? localDateKey(iso) : null;
    if (!date) {
      // Text like "First weekend of May 2026": default to the first Saturday of that month
      const info = planRaceInfo(trainingPlan);
      if (info.month !== null && /20\d{2}/.test(String(trainingPlan.raceDate || ''))) {
        const sat = new Date(info.year, info.month, 1);
        while (sat.getDay() !== 6) sat.setDate(sat.getDate() + 1);
        date = localDateKey(sat);
      }
    }
    if (date) {
      raceDates.push({ date, name: trainingPlan.race || 'Race' });
      renderRaceDateInputs();
      saveRaceDates();
    }
  }

  document.getElementById('btnImportZwo').style.display = 'inline-flex';
  if (allActivities.length) computePMC(); // weekly goal may now come from the plan
  let saved = true;
  if (typeof saveTrainingPlan === 'function') saved = await saveTrainingPlan(trainingPlan);
  const lines = [...result.warnings];
  if (!saved) lines.unshift('⚠️ The plan is shown but could not be saved to your account — it will be gone after a reload.');
  showPlanImportStatus(saved ? 'success' : 'error', `✅ ${result.summary}`, lines);
  showToast(result.summary, '✅');
  return true;
}

// Persistent import feedback in the Plan tab (text only — no HTML from the file)
function showPlanImportStatus(kind, title, lines = []) {
  const el = document.getElementById('planImportStatus');
  if (!el) return;
  el.className = `plan-import-status plan-import-status--${kind}`;
  el.replaceChildren();
  const head = document.createElement('div');
  head.className = 'plan-import-status-title';
  head.textContent = title;
  el.append(head);
  if (lines.length) {
    const ul = document.createElement('ul');
    for (const line of lines.slice(0, 12)) { const li = document.createElement('li'); li.textContent = line; ul.append(li); }
    if (lines.length > 12) { const li = document.createElement('li'); li.textContent = `…and ${lines.length - 12} more`; ul.append(li); }
    el.append(ul);
  }
  const close = document.createElement('button');
  close.className = 'btn-reset plan-import-status-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.onclick = () => { el.hidden = true; };
  el.append(close);
  el.hidden = false;
}

function importZwoFiles(fileList) {
  let count = 0;
  for (const file of Array.from(fileList)) {
    if (!file.name.toLowerCase().endsWith('.zwo')) continue;
    const reader = new FileReader();
    reader.onload = function(e) {
      zwoFiles[file.name] = e.target.result;
      count++;
      if (count === fileList.length || Object.keys(zwoFiles).length % 5 === 0) {
        renderTrainingPlan();
      }
    };
    reader.readAsText(file);
  }
  showToast(`Importing ${fileList.length} ZWO files...`, '📦');
  setTimeout(() => {
    showToast(`${Object.keys(zwoFiles).length} ZWO files loaded`, '✅');
    document.getElementById('btnDownloadAllZwo').style.display = 'inline-flex';
    renderTrainingPlan();
    if (typeof saveZwoFiles === 'function') saveZwoFiles(zwoFiles);
  }, 500);
}

// A session is done if ticked in the app, else if the plan file says "completed": true.
// Stored as explicit true/false so a session completed in the file can be un-ticked.
function isSessionTicked(s) { return s.id in planCompletions ? !!planCompletions[s.id] : !!s.completed; }

function toggleSessionComplete(sessionId) {
  const session = (trainingPlan?.weeks || []).flatMap(w => w.sessions || []).find(s => s.id === sessionId);
  if (!session) return;
  planCompletions[sessionId] = !isSessionTicked(session);
  renderTrainingPlan();
  if (allActivities.length) computePMC(); // week progress bar
  if (typeof savePlanCompletions === 'function') savePlanCompletions(planCompletions);
}

// ── Plan dates ──
// Imported plans are normalised by normalizePlan() (plan-import.js), which stores each week's
// start as "startDate" (YYYY-MM-DD). The text fallback covers plans that were never normalised.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Local-midnight start date of a plan week, or null if unknown
function planWeekStart(week, plan) {
  return parseIsoDate(week?.startDate) || parseWeekDatesStart(week?.dates, planRaceInfo(plan || {}));
}

// Date of a session within its week ("Tuesday" → the Tuesday on/after the week start)
function planSessionDate(weekStart, day) {
  const dow = WEEKDAYS.indexOf(String(day || '').toLowerCase());
  if (!weekStart || dow < 0) return null;
  return addDays(weekStart, (dow - weekStart.getDay() + 7) % 7);
}

// Actual date of a session: moved by the user (Calendar) or its planned day
function sessionDateFor(s, weekStart) {
  const moved = s && planOverrides[s.id] && parseIsoDate(planOverrides[s.id]);
  return moved || planSessionDate(weekStart, s && s.day);
}

function isWeekCurrent(week, plan, now) {
  const start = planWeekStart(week, plan);
  if (!start) return false;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return today >= start && today <= addDays(start, 6);
}

// Does an activity's sport satisfy a planned session's sport?
function planSportMatches(planSport, actSport) {
  const isRunning = ['running', 'trail_running'].includes(actSport);
  const isOther = !isCyc(actSport) && !isRun(actSport) && actSport !== 'swimming';
  switch (planSport) {
    case 'bike': return isCyc(actSport);
    case 'run': return isRunning;
    case 'swim': return actSport === 'swimming';
    case 'strength': return isOther;
    case 'strength+swim': return actSport === 'swimming' || isOther;
    case 'race': return true;
    default: return false; // rest days
  }
}

// Match plan sessions to activities done on the same day with a compatible sport.
// Returns Map(sessionId → activity); each activity satisfies at most one session.
function matchPlanToActivities(plan) {
  const byDay = {};
  for (const a of allActivities) (byDay[localDateKey(a.startDate)] ||= []).push(a);
  const used = new Set();
  const matches = new Map();
  for (const week of plan.weeks || []) {
    const start = planWeekStart(week, plan);
    for (const s of week.sessions || []) {
      const date = sessionDateFor(s, start);
      if (!date || !s.id) continue;
      const act = (byDay[localDateKey(date)] || []).find(a => !used.has(a) && planSportMatches(s.sport, a.sport));
      if (act) { used.add(act); matches.set(s.id, act); }
    }
  }
  return matches;
}

// Planned TSS for the week starting on `monday`: training plan first, then the Planner tab
function plannedTssForWeek(monday) {
  const key = localDateKey(monday);
  if (trainingPlan && trainingPlan.weeks) {
    const w = trainingPlan.weeks.find(w => { const s = planWeekStart(w, trainingPlan); return s && localDateKey(s) === key; });
    if (w && w.tss > 0) return { tss: +w.tss, source: `plan W${w.week}` };
  }
  const weeks = plannerData.length ? plannerData.map(p => ({ start: p.weekStart, tss: p.tss }))
    : (savedPlannerWeeks || []).map(w => ({ start: new Date(new Date(w.weekStart).getTime() + 12 * 3600000), tss: w.tss }));
  const pw = weeks.find(w => localDateKey(w.start) === key);
  if (pw && pw.tss > 0) return { tss: +pw.tss, source: 'planner' };
  return null;
}

function scrollToCurrentWeek() {
  // Wait for the tab to be visible, then jump to the current week and bring its chip into view
  setTimeout(() => {
    const el = document.querySelector('.plan-week-current');
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80 });
    const chip = document.querySelector('#planWeekPicker .chip.is-active');
    if (chip) chip.parentElement.scrollLeft = chip.offsetLeft - 16;
  }, 60);
}

function renderTrainingPlan() {
  if (!trainingPlan) return;
  const p = trainingPlan;
  document.getElementById('planEmpty').style.display = 'none';
  document.getElementById('planContent').style.display = 'block';
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const weeks = p.weeks || [];
  const currentIdx = weeks.findIndex(w => isWeekCurrent(w, p, now));

  // ── Header card: name + version, meta line, phase bar, zones / status ──
  const cal = p.calibration || {};
  const planName = p.name || p.planName || p.race || 'Training Plan';
  const planVersion = p.version || p.plan_version || p.planVersion || '';
  const raceIso = parseIsoDate(p.raceDate);
  const raceDateText = raceIso ? raceIso.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : (p.raceDate || '');
  const ftp = cal.ftp_watts || p.ftpWatts;
  const sessionCount = weeks.reduce((n, w) => n + (w.sessions || []).length, 0);
  const meta = [raceDateText ? `Race ${raceDateText}` : '', p.name && p.race ? p.race : '', p.athlete || '', `${weeks.length} weeks · ${sessionCount} sessions`, ftp ? `FTP ${ftp} W` : ''].filter(Boolean);
  const targets = [cal.run_race_target_pace ? `Run ${cal.run_race_target_pace}` : '', cal.bike_race_target_np ? `Bike ${cal.bike_race_target_np}` : '', cal.swim_target ? `Swim ${cal.swim_target}` : ''].filter(Boolean);
  // Phase bar: consecutive weeks with the same phase form one segment
  const phases = [];
  weeks.forEach((w, i) => { const ph = String(w.phase || '—'); if (phases.length && phases[phases.length - 1].name === ph) phases[phases.length - 1].to = i; else phases.push({ name: ph, from: i, to: i }); });
  const firstStart = weeks.length ? planWeekStart(weeks[0], p) : null;
  const lastStart = weeks.length ? planWeekStart(weeks[weeks.length - 1], p) : null;
  const shortDate = d => d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
  const where = currentIdx >= 0 ? `You are in <b>W${String(weeks[currentIdx].week).padStart(2, '0')}</b>`
    : firstStart && firstStart > today ? `Starts in ${Math.round((firstStart - today) / 86400000)} days` : 'Plan finished';
  document.getElementById('planHeader').innerHTML = `
    <div class="plan-header__top"><h2 class="plan-title">${escapeHtml(planName)}</h2>${planVersion ? `<span class="plan-version">${escapeHtml(planVersion)}</span>` : ''}</div>
    <p class="plan-meta">${meta.map(escapeHtml).join(' · ')}</p>
    ${targets.length ? `<p class="plan-meta">Targets: ${targets.map(escapeHtml).join(' · ')}</p>` : ''}
    ${phases.length > 1 || phases[0]?.name !== '—' ? `<div class="phase-bar">${phases.map(ph => {
      const state = currentIdx >= ph.from && currentIdx <= ph.to ? ' is-current' : currentIdx > ph.to ? ' is-past' : '';
      return `<div class="phase-bar__seg${state}" style="flex:${ph.to - ph.from + 1}">${escapeHtml(ph.name)}</div>`;
    }).join('')}</div>
    <div class="phase-bar__caption"><span>${escapeHtml(shortDate(firstStart))}</span><span>${where}</span><span>${escapeHtml(raceIso ? shortDate(raceIso) : shortDate(lastStart ? addDays(lastStart, 6) : null))}</span></div>` : ''}
    ${(p.structure_corrections || []).length ? `<div class="plan-corrections">${p.structure_corrections.map(c => '• ' + escapeHtml(c)).join('<br>')}</div>` : ''}
    <div class="plan-header__foot">${p.zones ? `<button class="btn-reset link-muted" onclick="togglePlanZones()">Zones ›</button>` : '<span></span>'}<span>Plan status: no errors</span></div>`;

  // Zones (toggled from the header)
  if (p.zones) {
    let zh = '<div class="compare-grid">';
    if (p.zones.bike) {
      zh += `<div><div class="card-title" style="margin-bottom:8px">Bike zones <span class="plan-meta">FTP ${escapeHtml(p.zones.bike.ftp)} W</span></div><table class="zone-table"><tr><th>Zone</th><th>Name</th><th>Power</th><th>%FTP</th></tr>`;
      for (const [zk, zv] of Object.entries(p.zones.bike)) if (zk !== 'ftp') zh += `<tr><td>${escapeHtml(zk)}</td><td>${escapeHtml(zv.name)}</td><td>${escapeHtml(zv.power)}</td><td>${escapeHtml(zv.ratio)}</td></tr>`;
      zh += '</table></div>';
    }
    if (p.zones.run) {
      zh += '<div><div class="card-title" style="margin-bottom:8px">Run zones</div><table class="zone-table"><tr><th>Zone</th><th>Name</th><th>Pace</th><th>HR</th></tr>';
      for (const [zk, zv] of Object.entries(p.zones.run)) zh += `<tr><td>${escapeHtml(zk)}</td><td>${escapeHtml(zv.name)}</td><td>${escapeHtml(zv.pace)}</td><td>${escapeHtml(zv.hr)}</td></tr>`;
      zh += '</table></div>';
    }
    document.getElementById('planZones').innerHTML = zh + '</div>';
  }

  // Week picker
  document.getElementById('planWeekPicker').innerHTML = weeks.map((w, i) =>
    `<button class="chip${i === currentIdx ? ' is-active' : ''}" onclick="jumpToPlanWeek(${i})">W${escapeHtml(String(w.week).padStart(2, '0'))}</button>`).join('');

  // ── Weeks: one card of session rows each ──
  const hasZwo = Object.keys(zwoFiles).length > 0;
  const matches = matchPlanToActivities(p);
  let wh = '';
  weeks.forEach((week, wi) => {
    const weekStart = planWeekStart(week, p);
    let tssText = `${escapeHtml(week.tss)} TSS`;
    if (weekStart && weekStart <= today) {
      const end = addDays(weekStart, 7);
      const actual = allActivities.reduce((sum, a) => sum + (a.startDate >= weekStart && a.startDate < end ? (a.tss || 0) : 0), 0);
      tssText = `<strong>${actual}</strong> / ${escapeHtml(week.tss)} TSS`;
    }
    const phase = week.phase ? String(week.phase)[0] + String(week.phase).slice(1).toLowerCase() : '';
    wh += `<section class="plan-week${wi === currentIdx ? ' plan-week-current' : ''}" data-plan-week="${wi}" id="plan-week-${wi}">
      <div class="plan-week-head"><h3 class="plan-week-title">W${escapeHtml(String(week.week).padStart(2, '0'))}${phase ? ` · <span class="plan-week-phase" style="color:${safeColor(week.color, 'var(--text-dim)')}">${escapeHtml(phase)}</span>` : ''}</h3>
      <span class="plan-week-meta">${tssText}</span></div>
      ${week.note ? `<p class="plan-week-note">${escapeHtml(week.note)}</p>` : ''}
      <div class="plan-sessions">`;
    for (const s of (week.sessions || [])) {
      const matched = matches.get(s.id);
      const isDone = !!(isSessionTicked(s) || matched);
      const sessionDate = sessionDateFor(s, weekStart);
      const isToday = sessionDate && localDateKey(sessionDate) === localDateKey(today);
      const isMissed = !isDone && s.sport !== 'rest' && sessionDate && sessionDate < today;
      const movedTo = planOverrides[s.id] && sessionDate ? sessionDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) : '';
      const check = s.sport === 'rest' ? '<span style="width:26px;display:inline-block"></span>'
        : matched ? `<label class="check" title="Completed — matched a Strava activity"><input type="checkbox" checked disabled aria-label="${escapeHtml(s.name)}: completed on Strava"><span class="check__box"><svg class="icon"><use href="#i-check"/></svg></span></label>`
        : `<label class="check"><input type="checkbox" ${isDone ? 'checked' : ''} aria-label="Mark ${escapeHtml(s.name)} as done" data-session-id="${escapeHtml(s.id)}" onchange="toggleSessionComplete(this.dataset.sessionId)"><span class="check__box"><svg class="icon"><use href="#i-check"/></svg></span></label>`;
      const right = s.sport === 'rest' ? '<span class="plan-session-tss">—</span>'
        : matched ? `<span class="plan-session-actual" title="${escapeHtml(fmtSportName(matched.sport))} · ${escapeHtml(fmtDuration(matched.duration))}">${escapeHtml(s.tss)} → ${escapeHtml(matched.tss)}</span>`
        : `<span class="plan-session-tss">TSS ${escapeHtml(s.tss)}</span>${isMissed ? '<div class="plan-session-missed">✕ missed</div>' : ''}`;
      const zwo = s.zwo_file && hasZwo && zwoFiles[s.zwo_file] ? `<button class="btn-reset link-muted" data-zwo="${escapeHtml(s.zwo_file)}" onclick="downloadZwo(this.dataset.zwo)">↓ .zwo</button>` : '';
      const details = sessionDetailsHtml(s);
      wh += `<div class="plan-session${isDone ? ' plan-session-done' : ''}${isToday ? ' plan-session-today' : ''}">
        <div class="plan-session-check">${check}</div>
        <div class="plan-session-body">
          <div class="plan-session-top">
            <div style="min-width:0"><div class="plan-session-caption">${sportDot(s.sport)}${escapeHtml(String(s.day || '').slice(0, 3))} · ${escapeHtml(sportLabel(s.sport))}${isToday ? ' · Today' : ''}${movedTo ? ` · <span class="plan-moved" title="Moved in the Calendar">↪ ${escapeHtml(movedTo)}</span>` : ''}</div>
              <div class="plan-session-name">${escapeHtml(s.name)}</div></div>
            <div class="plan-session-right">${right}${zwo ? `<div>${zwo}</div>` : ''}</div>
          </div>
          ${details || `${s.description ? `<div class="plan-session-desc${s.description.length > 200 ? ' is-clamped' : ''}">${escapeHtml(s.description)}</div>` : ''}${sessionMetaHtml(s)}`}
        </div></div>`;
    }
    wh += `</div></section>`;
  });
  document.getElementById('planWeeks').innerHTML = wh;
  renderUpcomingSessions();
  renderTodayHead();
  if (typeof renderCalendar === 'function' && document.getElementById('tab-calendar')?.classList.contains('is-active')) renderCalendar();
}

// Week picker: scroll the page to a plan week (never scrollIntoView: it also scrolls the tab bar on iOS)
function jumpToPlanWeek(i) {
  document.querySelectorAll('#planWeekPicker .chip').forEach((c, j) => c.classList.toggle('is-active', j === i));
  const el = document.getElementById(`plan-week-${i}`);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
}

// ── Overview: today's and tomorrow's planned sessions ──
function sessionsOnDate(plan, date) {
  const key = localDateKey(date), out = [];
  for (const week of plan.weeks || []) {
    const start = planWeekStart(week, plan);
    for (const s of week.sessions || []) {
      const d = sessionDateFor(s, start);
      if (d && localDateKey(d) === key) out.push(s);
    }
  }
  return out;
}

function renderUpcomingSessions(now = new Date()) {
  const card = document.getElementById('upcomingCard');
  if (!card) return;
  if (!trainingPlan) { card.style.display = 'none'; return; }
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);
  const matches = matchPlanToActivities(trainingPlan);
  const dayLabel = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });

  // Today: the first session as the big card, others as compact rows inside it
  const todays = sessionsOnDate(trainingPlan, today);
  let todayHtml;
  if (!todays.length) {
    todayHtml = `<article class="card session-card session-card--today"><div class="session-card__top"><span class="sport-label">Today</span></div>
      <h3 class="session-card__title">Nothing planned today</h3><p class="session-card__desc">Enjoy the rest, or check the plan for the week.</p>
      <div class="session-card__actions"><button class="btn btn--secondary btn--lg" onclick="openPlanTab()">Open plan</button></div></article>`;
  } else {
    const [s, ...more] = todays;
    todayHtml = todaySessionCardHtml(s, matches.get(s.id), more.map(x => sessionRowHtml(x, 'Also today', matches.get(x.id))).join(''));
  }

  // Tomorrow: compact rows that open the session sheet
  const tomorrows = sessionsOnDate(trainingPlan, tomorrow);
  const tomorrowHtml = `<div class="card upcoming-tomorrow">${tomorrows.length
    ? tomorrows.map(s => sessionRowHtml(s, `Tomorrow · ${dayLabel(tomorrow)}`, matches.get(s.id))).join('')
    : `<div class="list-row" style="cursor:default"><div class="list-row__main"><div class="list-row__caption">Tomorrow · ${escapeHtml(dayLabel(tomorrow))}</div><div class="list-row__title">Nothing planned</div></div></div>`}</div>`;

  document.getElementById('upcomingDays').innerHTML = todayHtml + tomorrowHtml;
  card.style.display = '';
}

// Plan sport or activity sport → CSS sport key and label
function sportKey(s) {
  if (s === 'bike' || isCyc(s)) return 'bike';
  if (s === 'run' || ['running', 'trail_running', 'walking', 'hiking'].includes(s)) return 'run';
  if (s === 'swim' || s === 'swimming') return 'swim';
  if (['strength', 'strength+swim', 'fitness_equipment'].includes(s)) return 'strength';
  if (s === 'race') return 'race';
  return 'rest';
}
function sportLabel(s) { return { bike: 'Bike', run: 'Run', swim: 'Swim', strength: 'Strength', race: 'Race', rest: s === 'rest' ? 'Rest' : fmtSportName(s) }[sportKey(s)]; }
function sportDot(s) { return `<i class="sport-dot" style="--sport:var(--sport-${sportKey(s)})" aria-hidden="true"></i>`; }

function todaySessionCardHtml(s, matched, extraRows = '') {
  const done = !!(isSessionTicked(s) || matched);
  const id = escapeHtml(s.id);
  const strip = [];
  if (s.durationMin) strip.push(['Duration', escapeHtml(fmtMinutes(s.durationMin))]);
  if (s.hrTarget) strip.push([/^[≤<]/.test(s.hrTarget) ? 'HR cap' : 'Heart rate', escapeHtml(s.hrTarget)]);
  if (s.powerTarget) { const m = String(s.powerTarget).match(/^(.*?)\s*\((.*)\)$/); strip.push(['Power', m ? `${escapeHtml(m[1])} <small>${escapeHtml(m[2])}</small>` : escapeHtml(s.powerTarget)]); }
  let actions;
  if (s.sport === 'rest') actions = `<button class="btn btn--secondary btn--lg" data-session-id="${id}" onclick="openSessionDialog(this.dataset.sessionId)">Details</button>`;
  else {
    const main = matched
      ? `<span class="btn btn--secondary btn--lg" style="cursor:default;color:var(--color-ok)">✓ Done · ${escapeHtml(matched.tss)} TSS</span>`
      : done ? `<button class="btn btn--secondary btn--lg" data-session-id="${id}" onclick="toggleSessionComplete(this.dataset.sessionId)" aria-pressed="true" style="color:var(--color-ok)">✓ Done</button>`
        : `<button class="btn btn--primary btn--lg" data-session-id="${id}" onclick="toggleSessionComplete(this.dataset.sessionId)" aria-pressed="false">Mark done</button>`;
    actions = main + `<button class="btn btn--secondary btn--lg" data-session-id="${id}" onclick="openSessionDialog(this.dataset.sessionId)">Details</button>`
      + (s.steps && s.steps.length && ['bike', 'run'].includes(s.sport) ? `<button class="btn btn--secondary btn--lg desktop-only" data-session-id="${id}" onclick="exportSessionWorkout(this.dataset.sessionId, 'zwo')"><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>.zwo</button>` : '');
  }
  return `<article class="card session-card session-card--today${done ? ' is-done' : ''}">
    <div class="session-card__top"><span class="sport-label">${sportDot(s.sport)}Today · ${escapeHtml(sportLabel(s.sport))}</span>${s.tss ? `<span class="tss">TSS ${escapeHtml(s.tss)}</span>` : ''}</div>
    <h3 class="session-card__title">${escapeHtml(s.name)}</h3>
    ${s.description ? `<p class="session-card__desc plan-session-desc${s.description.length > 200 ? ' is-clamped' : ''}">${escapeHtml(s.description)}</p>` : ''}
    ${strip.length ? `<div class="target-strip">${strip.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    <div class="session-card__actions">${actions}</div>
    ${extraRows ? `<div style="margin-top:14px;border-top:1px solid var(--border-subtle);padding-top:6px">${extraRows}</div>` : ''}
  </article>`;
}

// Compact session row (tomorrow, extra sessions): opens the session sheet
function sessionRowHtml(s, caption, matched) {
  const meta = [sessionMetaText(s), s.tss ? `TSS ${s.tss}` : ''].filter(Boolean).join(' · ');
  const done = !!(isSessionTicked(s) || matched);
  return `<button class="btn-reset list-row" data-session-id="${escapeHtml(s.id)}" onclick="openSessionDialog(this.dataset.sessionId)">
    ${sportDot(s.sport)}<div class="list-row__main"><div class="list-row__caption">${escapeHtml(caption)}${done ? ' · <span class="is-ok">✓ done</span>' : ''}</div>
    <div class="list-row__title">${escapeHtml(s.name)}</div>${meta ? `<div class="list-row__meta">${escapeHtml(meta)}</div>` : ''}</div>
    <svg class="icon" aria-hidden="true"><use href="#i-chevron-right"/></svg></button>`;
}

function openPlanTab() {
  const btn = [...document.querySelectorAll('.nav-tab')].find(b => b.getAttribute('onclick')?.includes("'plan'"));
  if (btn) switchTab('plan', btn);
}

// Duration, HR and power targets under the session name
// "50 min · ≤160 bpm · 170 W (85 % FTP)" — targets as one plain line
function sessionMetaText(s) { return [s.durationMin ? fmtMinutes(s.durationMin) : '', s.hrTarget || '', s.powerTarget || ''].filter(Boolean).join(' · '); }
function sessionMetaHtml(s) { const t = sessionMetaText(s); return t ? `<div class="plan-session-meta">${escapeHtml(t)}</div>` : ''; }
function fmtMinutes(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ' ' + String(m).padStart(2, '0') : ''}` : `${m} min`; }

// Expandable details: Markdown text, steps table, and the full description when it was clamped
function sessionDetailsHtml(s, { summary = true } = {}) {
  const parts = [];
  if (s.details || (s.steps && s.steps.length) || s.description || sessionMetaText(s)) {
    if (summary) {
      parts.push(sessionMetaHtml(s));
      if (s.description) parts.push(`<div class="plan-md"><p class="plan-md-pre">${escapeHtml(s.description)}</p></div>`);
    }
  } else return '';
  if (s.details) parts.push(`<div class="plan-md">${renderMarkdownSafe(s.details)}</div>`);
  if (s.steps && s.steps.length) {
    parts.push(`<div class="plan-steps-wrap"><table class="plan-steps"><thead><tr><th>Step</th><th>Time</th><th>Target</th><th>Rest</th></tr></thead><tbody>${
      s.steps.map(st => `<tr><td>${escapeHtml(st.label)}</td><td>${escapeHtml(st.duration || '—')}</td><td>${escapeHtml(st.target || '—')}</td><td>${escapeHtml(st.rest || '—')}</td></tr>`).join('')
    }</tbody></table></div>`);
    if (typeof workoutExportButtonsHtml === 'function') parts.push(workoutExportButtonsHtml(s));
  }
  return `<details class="plan-session-details"><summary>Details</summary>${parts.join('')}</details>`;
}

// Minimal, safe Markdown → HTML. Every piece of text is escaped first; only these constructs
// become markup: # headings, - / * / • and 1. lists, > quotes, **bold**, *italic* / _italic_,
// `code`, paragraphs and line breaks. Raw HTML in the source is shown as text, links as text.
function renderMarkdownSafe(md) {
  const inline = t => escapeHtml(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const rawLine of String(md).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^\s*(#{1,6})\s+(.*)$/))) { flushPara(); flushList(); out.push(`<div class="plan-md-h">${inline(m[2])}</div>`); continue; }
    if ((m = line.match(/^\s*>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/), ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('');
}

// Tap anywhere on a session card with details to expand/collapse it
document.addEventListener('click', e => {
  const body = e.target.closest?.('.plan-session-body');
  if (!body || e.target.closest('button, a, input, summary, .plan-session-details')) return;
  const det = body.querySelector('.plan-session-details');
  if (det) det.open = !det.open;
});

function togglePlanZones() {
  const el = document.getElementById('planZones');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function downloadZwo(filename) {
  const content = zwoFiles[filename];
  if (!content) { showToast('ZWO file not found', '❌'); return; }
  const blob = new Blob([content], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadAllZwos() {
  const keys = Object.keys(zwoFiles);
  if (!keys.length) { showToast('No ZWO files loaded', '❌'); return; }
  // Download individually (simple approach, no zip library needed)
  let i = 0;
  function next() {
    if (i >= keys.length) { showToast(`Downloaded ${keys.length} ZWO files`, '✅'); return; }
    downloadZwo(keys[i]);
    i++;
    setTimeout(next, 200);
  }
  next();
}

// Init auth on page load

async function loadSavedPlan() {
  if (typeof loadTrainingPlan === 'function') {
    let saved = null;
    try { saved = await loadTrainingPlan(); }
    catch (err) {
      console.error('Error loading plan:', err);
      showPlanImportStatus('error', 'Your saved plan could not be loaded — please re-import it', [err.message]);
    }
    // Normalise saved plans too, so older ones get ids, dates and recomputed TSS
    const normalized = saved ? normalizePlan(saved) : null;
    if (normalized && normalized.errors.length) {
      console.error('Saved plan is invalid:', normalized.errors);
      showPlanImportStatus('error', 'Your saved plan could not be loaded — please re-import it', normalized.errors);
    } else if (normalized) {
      trainingPlan = normalized.plan; renderTrainingPlan(); document.getElementById('btnImportZwo').style.display = 'inline-flex';
      if (allActivities.length) computePMC(); // weekly goal can now come from the plan
    }
  }
  if (typeof loadZwoFiles === 'function') {
    const saved = await loadZwoFiles();
    if (saved && Object.keys(saved).length) { zwoFiles = saved; document.getElementById('btnDownloadAllZwo').style.display = 'inline-flex'; renderTrainingPlan(); }
  }
  if (typeof loadPlanCompletions === 'function') {
    const saved = await loadPlanCompletions();
    if (saved) { planCompletions = saved; renderTrainingPlan(); }
  }
  loadRaceDates();
  if (typeof loadPlanOverrides === 'function') {
    planOverrides = await loadPlanOverrides();
    if (trainingPlan) renderTrainingPlan();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Installable app + offline shell (see sw.js)
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('Service worker not registered:', err));
  }
  if (typeof initAuth === 'function') initAuth();
  // Handle Strava OAuth callback if present in URL
  if (typeof handleStravaCallback === 'function') handleStravaCallback();
});
