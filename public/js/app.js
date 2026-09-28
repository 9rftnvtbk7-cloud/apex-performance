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
let currentRange = 'all';
let sessionDataLoaded = false;
let forecastTssEdited = false;

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
  btn.classList.add('is-active');
  btn.setAttribute('aria-selected', 'true');

  // Fade out current tab
  const currentTab = document.querySelector('.tab-content.is-active');
  const nextTab = document.getElementById('tab-' + tabId);
  if (currentTab && currentTab !== nextTab) {
    currentTab.style.opacity = '0';
    currentTab.style.transform = 'translateY(8px)';
    setTimeout(() => {
      currentTab.classList.remove('is-active');
      currentTab.style.opacity = '';
      currentTab.style.transform = '';
      // Fade in next tab
      nextTab.classList.add('is-entering');
      requestAnimationFrame(() => {
        nextTab.classList.remove('is-entering');
        nextTab.classList.add('is-active');
      });
    }, 150);
  } else if (!currentTab) {
    nextTab.classList.add('is-active');
  }

  if (tabId === 'compare') { initCompareDefaults(); renderComparison(); }
  if (tabId === 'planner') initPlanner();
  if (tabId === 'plan') scrollToCurrentWeek();
}

// ══════════════════════════════════════════════
// TSS Calculation
// ══════════════════════════════════════════════
function computeTSS(act) {
  const ftp = +document.getElementById('inputFtp').value || 200;
  const lthr = +document.getElementById('inputLthr').value || 165;
  const ts = paceToSpd(document.getElementById('inputPace').value || '5:00');
  const css = swimPaceToSpd(document.getElementById('inputSwimPace').value || '2:00');
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
  const sorted = [...allActivities].sort((a, b) => a.startDate - b.startDate);
  const f0 = new Date(sorted[0].startDate); f0.setHours(0, 0, 0, 0);
  const td = new Date(); td.setHours(0, 0, 0, 0);
  const nDays = Math.round((td - f0) / 86400000) + 1;
  const dTss = new Array(nDays).fill(0);
  for (const a of sorted) { const d = new Date(a.startDate); d.setHours(0, 0, 0, 0); const i = Math.round((d - f0) / 86400000); if (i >= 0 && i < nDays) dTss[i] += (a.tss || 0); }
  let ctl = 0, atl = 0;
  const labels = [], ctlV = [], atlV = [], tsbV = [];
  for (let i = 0; i < nDays; i++) {
    ctl += (dTss[i] - ctl) / 42; atl += (dTss[i] - atl) / 7;
    labels.push(localDateKey(addDays(f0, i)));
    ctlV.push(+ctl.toFixed(1)); atlV.push(+atl.toFixed(1)); tsbV.push(+(ctl - atl).toFixed(1));
  }
  const tssMap = {};
  for (const a of sorted) { const k = localDateKey(a.startDate); tssMap[k] = (tssMap[k] || 0) + (a.tss || 0); }
  const tssV = labels.map(l => tssMap[l] !== undefined ? tssMap[l] : null);
  pmcResult = { labels, ctlVals: ctlV, atlVals: atlV, tsbVals: tsbV, tssVals: tssV, lastCtl: ctl, lastAtl: atl };
  document.getElementById('valCtl').textContent = ctl.toFixed(1);
  document.getElementById('valAtl').textContent = atl.toFixed(1);
  const tsb = ctl - atl;
  const zone = tsbZone(tsb);
  document.getElementById('valTsb').textContent = tsb.toFixed(1);
  document.getElementById('valTsb').style.color = zone.color;
  document.getElementById('subTsb').textContent = zone.label;
  // Ramp rate: CTL change over the last 7 days
  const ramp = nDays > 7 ? ctlV[nDays - 1] - ctlV[nDays - 8] : null;
  const subCtl = document.getElementById('subCtl');
  if (ramp === null) { subCtl.textContent = '42-day exponential avg'; subCtl.style.color = ''; }
  else { const r = rampInfo(ramp); subCtl.textContent = `Ramp ${ramp >= 0 ? '+' : ''}${ramp.toFixed(1)}/wk · ${r.label}`; subCtl.style.color = r.color; }
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
  document.getElementById('subWeekTss').textContent = `${thisWeekCount} activities this week`;
  document.getElementById('valLastWeekTss').textContent = lastWeekTss.toLocaleString();
  document.getElementById('subLastWeekTss').textContent = `${lastWeekCount} activities last week`;

  // ── This Week Mini Summary ──
  renderWeekSummary(thisMonday, now, thisWeekTss, lastWeekTss);
}

function renderWeekSummary(thisMonday, now, thisWeekTss, lastWeekTss) {
  const summaryEl = document.getElementById('weekSummary');
  if (!summaryEl) return;

  const weekActs = allActivities.filter(a => {
    const d = new Date(a.startDate); d.setHours(0,0,0,0);
    return d >= thisMonday && d <= now;
  });

  if (weekActs.length === 0 && allActivities.length > 0) {
    // Show it but with "no activities yet" messaging
    summaryEl.style.display = 'block';
  } else if (weekActs.length > 0) {
    summaryEl.style.display = 'block';
  } else {
    summaryEl.style.display = 'none';
    return;
  }

  // Aggregate by sport category
  const sportBuckets = { cycling: { dur: 0, dist: 0, tss: 0, count: 0 }, running: { dur: 0, dist: 0, tss: 0, count: 0 }, swimming: { dur: 0, dist: 0, tss: 0, count: 0 }, other: { dur: 0, dist: 0, tss: 0, count: 0 } };
  for (const a of weekActs) {
    let cat = 'other';
    if (isCyc(a.sport)) cat = 'cycling';
    else if (isRun(a.sport)) cat = 'running';
    else if (a.sport === 'swimming') cat = 'swimming';
    sportBuckets[cat].dur += (a.duration || 0);
    sportBuckets[cat].dist += (a.distance || 0);
    sportBuckets[cat].tss += (a.tss || 0);
    sportBuckets[cat].count++;
  }

  const fmtSportSummary = (b, isSwiim) => {
    if (b.count === 0) return '<span style="color:var(--text-muted)">No activities</span>';
    const time = fmtDuration(b.dur);
    const dist = isSwiim ? (b.dist > 0 ? `${b.dist}m` : '') : (b.dist >= 1000 ? `${(b.dist / 1000).toFixed(1)}km` : (b.dist > 0 ? `${b.dist}m` : ''));
    return `${b.count}× · ${time}${dist ? ' · ' + dist : ''}`;
  };

  document.getElementById('weekCyclingStats').innerHTML = fmtSportSummary(sportBuckets.cycling, false);
  document.getElementById('weekRunningStats').innerHTML = fmtSportSummary(sportBuckets.running, false);
  document.getElementById('weekSwimmingStats').innerHTML = fmtSportSummary(sportBuckets.swimming, true);
  document.getElementById('weekOtherStats').innerHTML = fmtSportSummary(sportBuckets.other, false);

  // Progress bar — goal is this week's planned TSS (plan or Planner tab), else last week's TSS
  const planned = plannedTssForWeek(thisMonday);
  const goal = planned ? planned.tss : lastWeekTss > 0 ? lastWeekTss : (thisWeekTss > 0 ? Math.round(thisWeekTss * 1.5) : 400);
  const source = planned ? planned.source : lastWeekTss > 0 ? 'last week' : 'default';
  const pct = Math.min(100, Math.round((thisWeekTss / goal) * 100));
  document.getElementById('weekProgressLabel').textContent = `Weekly TSS vs ${planned ? 'planned' : 'goal'} (${source})`;
  document.getElementById('weekProgressText').textContent = `${thisWeekTss} / ${goal} TSS`;
  document.getElementById('weekProgressBar').style.width = pct + '%';
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

function computeSmallForecast() {
  const days = +document.getElementById('sliderForecastDays').value || 0;
  const avg = +document.getElementById('inputForecastTss').value || 0;
  if (!days || pmcResult.lastCtl == null) return { labels: [], ctl: [], atl: [], tsb: [] };
  let c = pmcResult.lastCtl, a = pmcResult.lastAtl;
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
  const fc = computeSmallForecast();
  if (pmcChart) pmcChart.destroy();

  const mL = pmcResult.labels || [], fL = fc.labels || [];
  const fullLabels = [...mL]; for (const l of fL) if (!fullLabels.includes(l)) fullLabels.push(l);
  const pad = a => { const o = [...a]; while (o.length < fullLabels.length) o.push(null); return o; };
  const padF = a => { const si = fullLabels.indexOf(fL[0]); const o = new Array(fullLabels.length).fill(null); for (let i = 0; i < a.length; i++) if (si + i < o.length) o[si + i] = a[i]; return o; };

  let labels = fullLabels;
  let ctlData = pad(pmcResult.ctlVals || []);
  let atlData = pad(pmcResult.atlVals || []);
  let tsbData = pad(pmcResult.tsbVals || []);
  let tssData = pad(pmcResult.tssVals || []);
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

  pmcChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'CTL (Fitness)', data: ctlData, borderColor: '#3b82f6', borderWidth: 2.5, pointRadius: 0, pointHitRadius: 6, tension: 0.3, fill: false, order: 2, spanGaps: true },
      { label: 'ATL (Fatigue)', data: atlData, borderColor: '#f43f5e', borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0.3, fill: false, order: 3, spanGaps: true },
      { label: 'TSB (Form)', data: tsbData, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', borderWidth: 1.5, pointRadius: 0, pointHitRadius: 6, tension: 0.3, fill: true, order: 4, spanGaps: true },
      { label: 'TSS', data: tssData, borderColor: 'rgba(245,158,11,0.7)', backgroundColor: 'rgba(245,158,11,0.5)', pointRadius: 4, pointHoverRadius: 7, showLine: false, order: 1, yAxisID: 'y1', spanGaps: false },
      { label: 'CTL Forecast', data: fcCtlData, borderColor: 'rgba(59,130,246,0.4)', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, tension: 0.3, order: 5, spanGaps: false },
      { label: 'ATL Forecast', data: fcAtlData, borderColor: 'rgba(244,63,94,0.3)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, order: 6, spanGaps: false },
      { label: 'TSB Forecast', data: fcTsbData, borderColor: 'rgba(16,185,129,0.3)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, order: 7, spanGaps: false },
    ]},
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#a3a8bc', padding: 12, cornerRadius: 8, filter: i => i.raw !== null,
        callbacks: { title: items => { if (!items.length) return ''; try { return new Date(items[0].label + 'T00:00:00').toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return items[0].label; } } } } },
      scales: {
        x: { type: 'category', grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#858aa3', font: { family: 'DM Sans', size: 11 }, maxTicksLimit: 12, autoSkip: true, callback: function (v) { const l = this.getLabelForValue(v); try { return new Date(l + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }); } catch (e) { return l; } } } },
        y: { position: 'left', grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#858aa3', font: { family: 'JetBrains Mono', size: 11 } }, title: { display: true, text: 'CTL / ATL / TSB', color: '#858aa3' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: 'rgba(245,158,11,0.6)', font: { family: 'JetBrains Mono', size: 11 } }, title: { display: true, text: 'TSS', color: 'rgba(245,158,11,0.6)' }, min: 0 }
      }
    }
  });
}

function updateForecast() { document.getElementById('displayForecastDays').textContent = `${document.getElementById('sliderForecastDays').value} days`; if (pmcChart) buildPMCChart(); }
function toggleChartDataset(i, btn) {
  if (!pmcChart) return;
  let hidden;
  if (i === 4) { hidden = !pmcChart.data.datasets[4].hidden; [4, 5, 6].forEach(j => pmcChart.data.datasets[j].hidden = hidden); }
  else { hidden = !pmcChart.data.datasets[i].hidden; pmcChart.data.datasets[i].hidden = hidden; }
  if (btn) btn.setAttribute('aria-pressed', String(!hidden));
  pmcChart.update();
}

function setCustomChartRange() {
  const from = document.getElementById('chartRangeFrom').value;
  const to = document.getElementById('chartRangeTo').value;
  if (!from || !to) return;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('is-active'));
  currentRange = { from, to };
  buildPMCChart();
}

function setChartRange(r, btn) {
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  currentRange = r;
  buildPMCChart();
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
  updatePlannerForecast();
  saveRaceDates();
}

function renderRaceDateInputs() {
  const container = document.getElementById('raceDateInputs');
  if (!container) return;
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
  if (saved) { raceDates = saved; renderRaceDateInputs(); }
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
  const sorted = [...allActivities].sort((a, b) => { const k = sortConfig.key; let va, vb; if (k === 'date') { va = a.startDate?.getTime() || 0; vb = b.startDate?.getTime() || 0; } else if (k === 'sport') { va = a.sport || ''; vb = b.sport || ''; } else { va = a[k] || 0; vb = b[k] || 0; } if (typeof va === 'string') return sortConfig.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); return sortConfig.dir === 'asc' ? va - vb : vb - va; });
  document.getElementById('tableBody').innerHTML = sorted.map((a, idx) => {
    const aid = a.id || ('local-' + idx);
    const checked = selectedActivityIds.has(aid) ? 'checked' : '';
    return `<tr class="${checked ? 'row-selected' : ''}"><td><input type="checkbox" class="row-checkbox" data-id="${escapeHtml(aid)}" ${checked} onchange="onRowSelect(this)" style="cursor:pointer"></td><td class="cell-mono">${fmtDate(a.startDate)}</td><td><span class="sport-tag sport-tag--${sportTagClass(a.sport)}">${sportEmoji(a.sport)} ${escapeHtml(fmtSportName(a.sport))}</span></td><td class="cell-mono">${fmtDuration(a.duration)}</td><td class="cell-mono">${fmtDist(a.distance, a.sport)}</td><td class="cell-tss">${a.tss || '—'}</td><td class="cell-mono">${a.intensityFactor ? a.intensityFactor.toFixed(2) : '—'}</td><td class="cell-mono">${a.avgHr ? a.avgHr + ' bpm' : '—'}</td><td class="cell-mono">${a.avgPower ? a.avgPower + 'w' : '—'}</td><td class="cell-mono">${a.calories ? a.calories.toLocaleString() : '—'}</td></tr>`;
  }).join('');
  document.getElementById('activityCount').textContent = `${allActivities.length} activit${allActivities.length === 1 ? 'y' : 'ies'}`;
  document.querySelectorAll('.training-table th').forEach(th => { const ok = th.dataset.col === sortConfig.key; th.classList.toggle('is-sorted', ok); const ar = th.querySelector('.sort-indicator'); if (ar) ar.textContent = (ok && sortConfig.dir === 'asc') ? '▲' : '▼'; });
}
function sortColumn(k) { sortConfig = { key: k, dir: (sortConfig.key === k && sortConfig.dir === 'desc') ? 'asc' : 'desc' }; renderTrainingTable(); }

// ══════════════════════════════════════════════
// Activity Selection & Delete
// ══════════════════════════════════════════════
let selectedActivityIds = new Set();

function onRowSelect(cb) {
  const id = cb.dataset.id;
  if (cb.checked) selectedActivityIds.add(id); else selectedActivityIds.delete(id);
  cb.closest('tr').classList.toggle('row-selected', cb.checked);
  updateSelectionUI();
}

function toggleSelectAll(checked) {
  document.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.checked = checked;
    const id = cb.dataset.id;
    if (checked) selectedActivityIds.add(id); else selectedActivityIds.delete(id);
    cb.closest('tr').classList.toggle('row-selected', checked);
  });
  updateSelectionUI();
}

function updateSelectionUI() {
  const n = selectedActivityIds.size;
  const sc = document.getElementById('selectedCount');
  const bd = document.getElementById('btnDeleteSelected');
  if (sc) { sc.style.display = n > 0 ? 'inline' : 'none'; sc.textContent = n + ' selected'; }
  if (bd) bd.style.display = n > 0 ? 'inline-flex' : 'none';
  const selectAll = document.getElementById('selectAllCheckbox');
  if (selectAll) {
    const total = document.querySelectorAll('.row-checkbox').length;
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
function sportEmoji(s) { if (isCyc(s)) return '🚴'; if (['running', 'walking'].includes(s)) return '🏃'; if (s === 'hiking') return '🥾'; if (s === 'swimming') return '🏊'; if (s === 'rowing') return '🚣'; return '💪'; }

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
  document.getElementById('overviewContent').style.display = has ? 'block' : 'none';
  document.getElementById('dangerZone').style.display = has ? 'flex' : 'none';
}

function refreshDashboard() {
  const has = allActivities.length > 0;
  setDashboardVisibility(has);
  renderTrainingTable();
  if (has) { computePMC(); buildPMCChart(); initCompareDefaults(); }
  // Plan vs actual depends on activities
  if (trainingPlan) renderTrainingPlan();
  // Plan, ZWO files, race dates and Strava tokens only need loading once per session
  if (!sessionDataLoaded && currentUser) {
    sessionDataLoaded = true;
    loadSavedPlan();
    if (typeof loadStravaTokens === 'function' && !stravaTokens) loadStravaTokens();
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
  const open = document.getElementById('settingsPanel').classList.toggle('is-open');
  document.getElementById('btnSettings').setAttribute('aria-expanded', String(open));
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
  if (!e.target.closest('.account-menu-wrap')) closeAccountMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('accountMenu')?.classList.contains('is-open')) {
    closeAccountMenu();
    document.getElementById('btnAccount').focus();
  }
});
function toggleDebug() { document.getElementById('debugPanel').classList.toggle('is-open'); }
function showToast(msg, icon = 'ℹ️') { const el = document.createElement('div'); el.className = 'toast-notification'; const ic = document.createElement('span'); ic.textContent = icon; el.append(ic, ' ' + msg); document.body.appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2500); setTimeout(() => el.remove(), 3000); }


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
      const date = planSessionDate(start, s.day);
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
  // Wait for the tab fade-in (150ms in switchTab) so the element is visible
  setTimeout(() => {
    const el = document.querySelector('.plan-week-current');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 250);
}

function renderTrainingPlan() {
  if (!trainingPlan) return;
  const p = trainingPlan;
  document.getElementById('planEmpty').style.display = 'none';
  document.getElementById('planContent').style.display = 'block';

  // Header: plan name + version, then race, date and athlete
  const cal = p.calibration || {};
  const planName = p.name || p.planName || p.race || 'Training Plan';
  const planVersion = p.version || p.plan_version || p.planVersion || '';
  const raceIso = parseIsoDate(p.raceDate);
  const raceDateText = raceIso ? raceIso.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : (p.raceDate || '');
  const subtitle = [p.name && p.race ? p.race : '', raceDateText ? `🏁 ${raceDateText}` : '', p.athlete || '',
    `${(p.weeks || []).length} weeks · ${(p.weeks || []).reduce((n, w) => n + (w.sessions || []).length, 0)} sessions`,
    p.generated ? `generated ${p.generated}` : ''].filter(Boolean).map(escapeHtml).join(' · ');
  const ftp = cal.ftp_watts || p.ftpWatts;
  document.getElementById('planHeader').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px">
      <div style="min-width:0">
        <div class="plan-title">${escapeHtml(planName)}${planVersion ? ` <span class="plan-version">${escapeHtml(planVersion)}</span>` : ''}</div>
        <div class="plan-subtitle">${subtitle}</div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${ftp ? `<div class="plan-cal-chip">FTP <strong>${escapeHtml(ftp)}W</strong></div>` : ''}
        ${cal.run_race_target_pace ? `<div class="plan-cal-chip">Run Target <strong>${escapeHtml(cal.run_race_target_pace)}</strong></div>` : ''}
        ${cal.bike_race_target_np ? `<div class="plan-cal-chip">Bike Target <strong>${escapeHtml(cal.bike_race_target_np)}</strong></div>` : ''}
        ${cal.swim_target ? `<div class="plan-cal-chip">Swim Target <strong>${escapeHtml(cal.swim_target)}</strong></div>` : ''}
      </div>
    </div>
    ${(p.structure_corrections || []).length ? `<div style="margin-top:12px;font-size:13px;color:var(--text-dim)">${p.structure_corrections.map(c => '• ' + escapeHtml(c)).join('<br>')}</div>` : ''}
  `;

  // Zones
  if (p.zones) {
    let zh = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    if (p.zones.bike) {
      zh += '<div><div style="font-weight:600;margin-bottom:8px;color:var(--color-blue)">🚴 Bike Zones (FTP: ' + escapeHtml(p.zones.bike.ftp) + 'W)</div>';
      zh += '<table class="zone-table"><tr><th>Zone</th><th>Name</th><th>Power</th><th>%FTP</th></tr>';
      for (const [zk, zv] of Object.entries(p.zones.bike)) {
        if (zk === 'ftp') continue;
        zh += `<tr><td>${escapeHtml(zk)}</td><td>${escapeHtml(zv.name)}</td><td>${escapeHtml(zv.power)}</td><td>${escapeHtml(zv.ratio)}</td></tr>`;
      }
      zh += '</table></div>';
    }
    if (p.zones.run) {
      zh += '<div><div style="font-weight:600;margin-bottom:8px;color:var(--color-green)">🏃 Run Zones</div>';
      zh += '<table class="zone-table"><tr><th>Zone</th><th>Name</th><th>Pace</th><th>HR</th></tr>';
      for (const [zk, zv] of Object.entries(p.zones.run)) {
        zh += `<tr><td>${escapeHtml(zk)}</td><td>${escapeHtml(zv.name)}</td><td>${escapeHtml(zv.pace)}</td><td>${escapeHtml(zv.hr)}</td></tr>`;
      }
      zh += '</table></div>';
    }
    zh += '</div>';
    document.getElementById('planZones').innerHTML = zh;
  }

  // Weeks
  const hasZwo = Object.keys(zwoFiles).length > 0;
  const sportColors = { bike: '#3b82f6', run: '#10b981', swim: '#06b6d4', strength: '#a855f7', 'strength+swim': '#8b5cf6' };
  const sportEmojis = { bike: '🚴', run: '🏃', swim: '🏊', strength: '💪', 'strength+swim': '💪🏊' };

  let wh = '';
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  // Plan vs actual: sessions matched to Strava activities on the same day and sport
  const matches = matchPlanToActivities(p);
  for (let wi = 0; wi < (p.weeks || []).length; wi++) {
    const week = p.weeks[wi];
    // Phase colour from the plan; readable neutral text when the plan has none
    const phaseBg = safeColor(week.color, 'var(--text-dim)');
    const isCurrentWeek = isWeekCurrent(week, p, now);
    const weekStart = planWeekStart(week, p);
    // Actual TSS for weeks that have started (all activities in the week, planned or not)
    let actualHtml = '';
    if (weekStart && weekStart <= today) {
      const end = addDays(weekStart, 7);
      const actual = allActivities.reduce((sum, a) => sum + (a.startDate >= weekStart && a.startDate < end ? (a.tss || 0) : 0), 0);
      actualHtml = `<span class="plan-week-actual">actual <strong>${actual}</strong> /</span>`;
    }
    wh += `<div class="plan-week-card${isCurrentWeek ? ' plan-week-current' : ''}" data-plan-week="${wi}" id="plan-week-${wi}">`;
    wh += `<div class="plan-week-header" style="border-left:4px solid ${isCurrentWeek ? 'var(--color-blue)' : phaseBg}">`;
    wh += `<div><span class="plan-week-num">W${escapeHtml(week.week)}</span> <span class="plan-week-phase" style="color:${phaseBg}">${escapeHtml(week.phase)}</span></div>`;
    wh += `<div class="plan-week-meta"><span style="font-size:13px;color:var(--text-dim)">${escapeHtml(week.dates)}</span>${actualHtml}<span class="plan-week-tss">TSS ${escapeHtml(week.tss)}</span></div>`;
    wh += `</div>`;
    if (week.note) wh += `<div class="plan-week-note">${escapeHtml(week.note)}</div>`;
    wh += `<div class="plan-sessions">`;
    for (const s of (week.sessions || [])) {
      const sc = sportColors[s.sport] || '#6b7280';
      const se = sportEmojis[s.sport] || '🏋️';
      const hasFile = s.zwo_file && (hasZwo ? zwoFiles[s.zwo_file] : true);
      const matched = matches.get(s.id);
      const isDone = !!(isSessionTicked(s) || matched);
      const sessionDate = planSessionDate(weekStart, s.day);
      const isMissed = !isDone && s.sport !== 'rest' && sessionDate && sessionDate < today;
      wh += `<div class="plan-session${isDone ? ' plan-session-done' : ''}">`;
      wh += matched
        ? `<div class="plan-session-check"><input type="checkbox" checked disabled aria-label="Completed on Strava" title="Completed — matched a Strava activity" style="width:16px;height:16px;accent-color:var(--color-green)"></div>`
        : `<div class="plan-session-check"><input type="checkbox" ${isDone ? 'checked' : ''} aria-label="Mark ${escapeHtml(s.name)} as done" data-session-id="${escapeHtml(s.id)}" onchange="toggleSessionComplete(this.dataset.sessionId)" style="cursor:pointer;width:16px;height:16px;accent-color:var(--color-green)"></div>`;
      wh += `<div class="plan-session-day">${escapeHtml(String(s.day || '').slice(0, 3))}</div>`;
      wh += `<div class="plan-session-body">`;
      wh += `<div class="plan-session-top"><span class="plan-session-sport" style="background:${sc}22;color:${sc}">${se} ${escapeHtml(s.sport)}</span>`;
      wh += `<span class="plan-session-name">${escapeHtml(s.name)}</span>`;
      wh += `<span class="plan-session-tss">TSS ${escapeHtml(s.tss)}</span>`;
      if (matched) wh += `<span class="plan-session-actual" title="${escapeHtml(fmtSportName(matched.sport))} · ${escapeHtml(fmtDuration(matched.duration))}">✓ ${escapeHtml(matched.tss)} TSS actual</span>`;
      else if (isMissed) wh += `<span class="plan-session-missed">missed</span>`;
      if (s.zwo_file && hasZwo && zwoFiles[s.zwo_file]) {
        wh += `<button class="plan-zwo-btn" data-zwo="${escapeHtml(s.zwo_file)}" onclick="downloadZwo(this.dataset.zwo)">⬇ .zwo</button>`;
      } else if (s.zwo_file && !hasZwo) {
        wh += `<span class="plan-zwo-pending" title="Import ZWO files to enable download">📄 .zwo</span>`;
      }
      wh += `</div>`;
      if (s.description) wh += `<div class="plan-session-desc${s.description.length > 200 ? ' is-clamped' : ''}">${escapeHtml(s.description)}</div>`;
      wh += sessionMetaHtml(s);
      wh += sessionDetailsHtml(s);
      wh += `</div></div>`;
    }
    wh += `</div></div>`;
  }
  document.getElementById('planWeeks').innerHTML = wh;
}

// Duration, HR and power targets under the session name
function sessionMetaHtml(s) {
  const items = [];
  if (s.durationMin) items.push(`⏱ ${escapeHtml(fmtMinutes(s.durationMin))}`);
  if (s.hrTarget) items.push(`❤️ ${escapeHtml(s.hrTarget)}`);
  if (s.powerTarget) items.push(`⚡ ${escapeHtml(s.powerTarget)}`);
  return items.length ? `<div class="plan-session-meta">${items.map(i => `<span>${i}</span>`).join('')}</div>` : '';
}
function fmtMinutes(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`; }

// Expandable details: Markdown text, steps table, and the full description when it was clamped
function sessionDetailsHtml(s) {
  const parts = [];
  if (s.description && s.description.length > 200 && !s.details) parts.push(`<div class="plan-md"><p class="plan-md-pre">${escapeHtml(s.description)}</p></div>`);
  if (s.details) parts.push(`<div class="plan-md">${renderMarkdownSafe(s.details)}</div>`);
  if (s.steps && s.steps.length) {
    parts.push(`<div class="plan-steps-wrap"><table class="plan-steps"><thead><tr><th>Step</th><th>Time</th><th>Target</th><th>Rest</th></tr></thead><tbody>${
      s.steps.map(st => `<tr><td>${escapeHtml(st.label)}</td><td>${escapeHtml(st.duration || '—')}</td><td>${escapeHtml(st.target || '—')}</td><td>${escapeHtml(st.rest || '—')}</td></tr>`).join('')
    }</tbody></table></div>`);
  }
  return parts.length ? `<details class="plan-session-details"><summary>Details</summary>${parts.join('')}</details>` : '';
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
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof initAuth === 'function') initAuth();
  // Handle Strava OAuth callback if present in URL
  if (typeof handleStravaCallback === 'function') handleStravaCallback();
});
