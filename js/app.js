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

function log(msg, type) {
  console.log(msg);
  const el = document.getElementById('debugPanel');
  if (el) {
    const cls = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : type === 'info' ? 'log-info' : '';
    el.innerHTML += `<div class="${cls}">${msg}</div>`;
    el.scrollTop = el.scrollHeight;
  }
}

// ══════════════════════════════════════════════
// Tab Navigation
// ══════════════════════════════════════════════
function switchTab(tabId, btn) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('is-active'));
  btn.classList.add('is-active');

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
}

// ══════════════════════════════════════════════
// TSS Calculation
// ══════════════════════════════════════════════
function computeTSS(act) {
  const ftp = +document.getElementById('inputFtp').value || 200;
  const lthr = +document.getElementById('inputLthr').value || 165;
  const ts = paceToSpd(document.getElementById('inputPace').value || '5:00');
  const d = act.duration;
  if (act.np > 0 && ftp > 0) { const i = act.np / ftp; return { tss: Math.round(d * act.np * i / (ftp * 3600) * 100), intensityFactor: +i.toFixed(2) }; }
  if (act.avgPower > 0 && isCyc(act.sport)) { const p = act.np || act.avgPower, i = p / ftp; return { tss: Math.round(d * p * i / (ftp * 3600) * 100), intensityFactor: +i.toFixed(2) }; }
  if (isRun(act.sport) && act.avgSpeed > 0 && ts > 0) { const i = act.avgSpeed / ts; return { tss: Math.round(Math.min(d / 3600 * i * i * 100, 500)), intensityFactor: +i.toFixed(2) }; }
  if (act.avgHr > 0 && lthr > 0) { const i = act.avgHr / lthr; return { tss: Math.round(Math.min(d / 3600 * i * i * 100, 500)), intensityFactor: +i.toFixed(2) }; }
  return { tss: Math.round(Math.min(d / 3600 * 50, 500)), intensityFactor: null };
}
function isCyc(s) { return ['cycling', 'indoor_cycling', 'virtual_ride', 'e_biking'].includes(s); }
function isRun(s) { return ['running', 'walking', 'hiking', 'trail_running'].includes(s); }
function paceToSpd(s) { const p = s.split(':'); return 1000 / ((+p[0] || 5) * 60 + (+p[1] || 0)); }

// ══════════════════════════════════════════════
// PMC
// ══════════════════════════════════════════════
function computePMC() {
  if (!allActivities.length) return;
  const sorted = [...allActivities].sort((a, b) => a.startDate - b.startDate);
  const f0 = new Date(sorted[0].startDate); f0.setHours(0, 0, 0, 0);
  const td = new Date(); td.setHours(0, 0, 0, 0);
  const nDays = Math.ceil((td - f0) / 86400000) + 1;
  const dTss = new Array(nDays).fill(0);
  for (const a of sorted) { const d = new Date(a.startDate); d.setHours(0, 0, 0, 0); const i = Math.round((d - f0) / 86400000); if (i >= 0 && i < nDays) dTss[i] += (a.tss || 0); }
  let ctl = 0, atl = 0;
  const labels = [], ctlV = [], atlV = [], tsbV = [];
  for (let i = 0; i < nDays; i++) {
    ctl += (dTss[i] - ctl) / 42; atl += (dTss[i] - atl) / 7;
    labels.push(new Date(f0.getTime() + i * 86400000).toISOString().slice(0, 10));
    ctlV.push(+ctl.toFixed(1)); atlV.push(+atl.toFixed(1)); tsbV.push(+(ctl - atl).toFixed(1));
  }
  const tssMap = {};
  for (const a of sorted) { const dk = new Date(a.startDate); dk.setHours(0, 0, 0, 0); const k = dk.toISOString().slice(0, 10); tssMap[k] = (tssMap[k] || 0) + (a.tss || 0); }
  const tssV = labels.map(l => tssMap[l] !== undefined ? tssMap[l] : null);
  pmcResult = { labels, ctlVals: ctlV, atlVals: atlV, tsbVals: tsbV, tssVals: tssV, lastCtl: ctl, lastAtl: atl };
  document.getElementById('valCtl').textContent = ctl.toFixed(1);
  document.getElementById('valAtl').textContent = atl.toFixed(1);
  const tsb = ctl - atl;
  document.getElementById('valTsb').textContent = tsb.toFixed(1);
  document.getElementById('valTsb').style.color = tsb >= 0 ? 'var(--color-green)' : 'var(--color-red)';
  document.getElementById('subTsb').textContent = tsb >= 0 ? 'Fresh — ready to perform' : 'Fatigued — recovery needed';
  // Weekly TSS stats
  const now = new Date(); now.setHours(0,0,0,0);
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const thisMonday = new Date(now.getTime() - dayOfWeek * 86400000);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400000);
  const lastSunday = new Date(thisMonday.getTime() - 86400000);
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

  // Progress bar — use last week as goal, or if no last week, use a reasonable default
  const goal = lastWeekTss > 0 ? lastWeekTss : (thisWeekTss > 0 ? Math.round(thisWeekTss * 1.5) : 400);
  const pct = Math.min(100, Math.round((thisWeekTss / goal) * 100));
  document.getElementById('weekProgressText').textContent = `${thisWeekTss} / ${goal} TSS`;
  document.getElementById('weekProgressBar').style.width = pct + '%';
}

function computeSmallForecast() {
  const days = +document.getElementById('sliderForecastDays').value || 0;
  const avg = +document.getElementById('inputForecastTss').value || 0;
  if (!days || pmcResult.lastCtl == null) return { labels: [], ctl: [], atl: [], tsb: [] };
  let c = pmcResult.lastCtl, a = pmcResult.lastAtl;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const fl = [], fc = [], fa = [], ft = [];
  fl.push(now.toISOString().slice(0, 10)); fc.push(+c.toFixed(1)); fa.push(+a.toFixed(1)); ft.push(+(c - a).toFixed(1));
  for (let i = 1; i <= days; i++) { c += (avg - c) / 42; a += (avg - a) / 7; fl.push(new Date(now.getTime() + i * 86400000).toISOString().slice(0, 10)); fc.push(+c.toFixed(1)); fa.push(+a.toFixed(1)); ft.push(+(c - a).toFixed(1)); }
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
      cutoff = new Date(td.getTime() - days * 86400000).toISOString().slice(0, 10);
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
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#8b8fa4', padding: 12, cornerRadius: 8, filter: i => i.raw !== null,
        callbacks: { title: items => { if (!items.length) return ''; try { return new Date(items[0].label + 'T00:00:00').toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return items[0].label; } } } } },
      scales: {
        x: { type: 'category', grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#5a5e74', font: { family: 'DM Sans', size: 11 }, maxTicksLimit: 12, autoSkip: true, callback: function (v) { const l = this.getLabelForValue(v); try { return new Date(l + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }); } catch (e) { return l; } } } },
        y: { position: 'left', grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#5a5e74', font: { family: 'JetBrains Mono', size: 11 } }, title: { display: true, text: 'CTL / ATL / TSB', color: '#5a5e74' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: 'rgba(245,158,11,0.6)', font: { family: 'JetBrains Mono', size: 11 } }, title: { display: true, text: 'TSS', color: 'rgba(245,158,11,0.6)' }, min: 0 }
      }
    }
  });
}

function updateForecast() { document.getElementById('displayForecastDays').textContent = `${document.getElementById('sliderForecastDays').value} days`; if (pmcChart) buildPMCChart(); }
function toggleChartDataset(i) { if (!pmcChart) return; if (i === 4) { const h = !pmcChart.data.datasets[4].hidden; [4, 5, 6].forEach(j => pmcChart.data.datasets[j].hidden = h); } else pmcChart.data.datasets[i].hidden = !pmcChart.data.datasets[i].hidden; pmcChart.update(); }

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
  document.getElementById('compareFrom').value = sorted[0].startDate.toISOString().slice(0, 10);
  document.getElementById('compareTo').value = new Date().toISOString().slice(0, 10);
  const sports = [...new Set(allActivities.map(a => a.sport))].sort();
  document.getElementById('compareSport').innerHTML = '<option value="all">All Sports</option>' + sports.map(s => `<option value="${s}">${fmtSportName(s)}</option>`).join('');
  // Populate year selectors
  const years = [...new Set(allActivities.map(a => a.startDate.getFullYear()))].sort();
  const yearOpts = years.map(y => `<option value="${y}">${y}</option>`).join('');
  const yA = document.getElementById('compareYearA');
  const yB = document.getElementById('compareYearB');
  if (yA && yB) { yA.innerHTML = yearOpts; yB.innerHTML = yearOpts; if (years.length >= 2) { yA.value = years[years.length - 2]; yB.value = years[years.length - 1]; } else if (years.length === 1) { yA.value = years[0]; yB.value = years[0]; } }
  // Populate month selectors (all months that have data)
  const monthSet = new Set();
  allActivities.forEach(a => monthSet.add(a.startDate.toISOString().slice(0, 7)));
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
    ]}, options: { responsive:true, maintainAspectRatio:false, animation:false, plugins: { legend:{display:true,labels:{color:'#8b8fa4'}}, tooltip:{backgroundColor:'#1e2030',borderColor:'#2a2d3e',borderWidth:1,titleColor:'#e8eaf0',bodyColor:'#8b8fa4',padding:12,cornerRadius:8} }, scales: { x:{grid:{color:'rgba(42,45,62,0.4)'},ticks:{color:'#5a5e74',maxRotation:45}}, y:{position:'left',grid:{color:'rgba(42,45,62,0.3)'},ticks:{color:'rgba(245,158,11,0.7)'},title:{display:true,text:'TSS',color:'rgba(245,158,11,0.7)'}}, y1:{position:'right',grid:{drawOnChartArea:false},ticks:{color:'rgba(59,130,246,0.7)'},title:{display:true,text:'Hours',color:'rgba(59,130,246,0.7)'},min:0} } }
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
  area.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding-bottom:32px">' + chartDefs.map((_,i) => `<div style="height:280px;position:relative"><canvas id="cmpChart${i}"></canvas></div>`).join('') + '</div>';
  chartDefs.forEach((cd, i) => {
    const c = new Chart(document.getElementById('cmpChart'+i).getContext('2d'), {
      type: 'bar', data: { labels: datasets.map(ds=>ds.label), datasets: [{ data: cd.data, backgroundColor: cd.color, borderRadius: 6, barPercentage: 0.6 }] },
      options: { responsive:true, maintainAspectRatio:false, animation:false, plugins: { legend:{display:false}, title:{display:true,text:cd.title,color:'#e8eaf0',font:{size:14,family:'DM Sans',weight:600},padding:{bottom:12}}, tooltip:{backgroundColor:'#1e2030',borderColor:'#2a2d3e',borderWidth:1,titleColor:'#e8eaf0',bodyColor:'#8b8fa4',padding:12,cornerRadius:8} }, scales: { x:{grid:{color:'rgba(42,45,62,0.4)'},ticks:{color:'#8b8fa4',font:{size:12}}}, y:{grid:{color:'rgba(42,45,62,0.3)'},ticks:{color:'#5a5e74'},beginAtZero:true} } }
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
  area.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding-bottom:32px">' + metricDefs.map((_,i) => `<div style="height:280px;position:relative"><canvas id="cmpChart${i}"></canvas></div>`).join('') + '</div>';

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
          legend: { display: true, labels: { color: '#8b8fa4', usePointStyle: true, pointStyle: 'line' } },
          title: { display: true, text: md.title, color: '#e8eaf0', font: { size: 14, family: 'DM Sans', weight: 600 }, padding: { bottom: 12 } },
          tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#8b8fa4', padding: 12, cornerRadius: 8 }
        },
        scales: {
          x: { type: 'linear', min: 0, max: maxDays, grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#5a5e74', callback: v => 'Day ' + v }, title: { display: true, text: 'Days into period', color: '#5a5e74' } },
          y: { grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#5a5e74' }, beginAtZero: true }
        }
      }
    });
    compareCharts.push(c);
  });
}

function getPeriodKey(date, g) { const d = new Date(date); if (g === 'year') return d.getFullYear().toString(); if (g === 'month') return d.toISOString().slice(0, 7); const t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + 3 - (t.getDay() + 6) % 7); const w1 = new Date(t.getFullYear(), 0, 4); const wn = 1 + Math.round(((t - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7); return `${t.getFullYear()}-W${String(wn).padStart(2, '0')}`; }
function formatPeriodLabel(key, g) { if (g === 'year') return key; if (g === 'month') { const [y, m] = key.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m) - 1] + ' ' + y; } return key; }

// ══════════════════════════════════════════════
// Planner
// ══════════════════════════════════════════════
function initPlanner() {
  if (plannerInited) { updatePlannerForecast(); return; }
  plannerInited = true;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dow = now.getDay(), daysToMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  const startMon = new Date(now.getTime() + daysToMon * 86400000);
  plannerData = [];
  for (let w = 0; w < 26; w++) {
    const ws = new Date(startMon.getTime() + w * 7 * 86400000);
    const we = new Date(ws.getTime() + 6 * 86400000);
    plannerData.push({ weekStart: ws, weekLabel: `${ws.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${we.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, monthLabel: ws.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), tss: 0 });
  }
  // Restore saved planner data
  if (savedPlannerWeeks && savedPlannerWeeks.length) {
    for (let i = 0; i < Math.min(savedPlannerWeeks.length, plannerData.length); i++) {
      plannerData[i].tss = savedPlannerWeeks[i].tss || 0;
    }
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
    if (pw.dates) {
      const parts = pw.dates.split('–').map(s => s.trim());
      if (parts.length >= 1) {
        // Parse "Feb 23" or "Mar 1" — add current year context
        const year = new Date().getFullYear();
        const tryParse = str => {
          const d = new Date(str + ' ' + year);
          if (isNaN(d)) return new Date(str + ', ' + year);
          return d;
        };
        const startDate = tryParse(parts[0]);
        if (!isNaN(startDate)) {
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
      <input type="date" class="compare-date-input" value="${r.date}" onchange="updateRaceDate(${i},'date',this.value)" style="font-size:12px;padding:3px 6px">
      <input type="text" class="settings-input" value="${r.name}" placeholder="Race name" onchange="updateRaceDate(${i},'name',this.value)" style="font-size:12px;padding:3px 6px;width:120px;margin:0">
      <button onclick="removeRaceDate(${i})" style="background:none;border:none;color:var(--color-red);cursor:pointer;font-size:14px;padding:2px 4px" title="Remove">✕</button>
    </div>
  `).join('');
}

function saveRaceDates() {
  if (typeof savePlanCompletions === 'function' && currentUser) {
    // Store race dates alongside completions
    db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('raceDates').set({
        data: JSON.stringify(raceDates),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).catch(e => console.error('Error saving race dates:', e));
  }
}

async function loadRaceDates() {
  if (!currentUser) return;
  try {
    const doc = await db.collection('users').doc(currentUser.uid)
      .collection('plan').doc('raceDates').get();
    if (doc.exists && doc.data().data) {
      raceDates = JSON.parse(doc.data().data);
      renderRaceDateInputs();
    }
  } catch(e) { console.error('Error loading race dates:', e); }
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
        ctx.fillStyle = '#8b8fa4';
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
        legend: { display: true, labels: { color: '#8b8fa4', usePointStyle: true, pointStyle: 'line' } },
        tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#8b8fa4', padding: 12, cornerRadius: 8 }
      },
      scales: {
        x: { grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#5a5e74', maxRotation: 45 } },
        y: { grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#5a5e74' }, title: { display: true, text: 'CTL / ATL / TSB', color: '#5a5e74' } }
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
    return `<tr class="${checked ? 'row-selected' : ''}"><td><input type="checkbox" class="row-checkbox" data-id="${aid}" ${checked} onchange="onRowSelect(this)" style="cursor:pointer"></td><td class="cell-mono">${fmtDate(a.startDate)}</td><td><span class="sport-tag sport-tag--${sportTagClass(a.sport)}">${sportEmoji(a.sport)} ${fmtSportName(a.sport)}</span></td><td class="cell-mono">${fmtDuration(a.duration)}</td><td class="cell-mono">${fmtDist(a.distance, a.sport)}</td><td class="cell-tss">${a.tss || '—'}</td><td class="cell-mono">${a.intensityFactor ? a.intensityFactor.toFixed(2) : '—'}</td><td class="cell-mono">${a.avgHr ? a.avgHr + ' bpm' : '—'}</td><td class="cell-mono">${a.avgPower ? a.avgPower + 'w' : '—'}</td><td class="cell-mono">${a.calories ? a.calories.toLocaleString() : '—'}</td></tr>`;
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
  for (const id of selectedActivityIds) {
    if (id && !id.startsWith('local-') && typeof deleteActivity === 'function' && currentUser) {
      await deleteActivity(id);
    }
    const idx = allActivities.findIndex(a => a.id === id);
    if (idx >= 0) allActivities.splice(idx, 1);
  }
  selectedActivityIds.clear();
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
  document.getElementById('fileInputEl').value = '';
}

function refreshDashboard() {
  const has = allActivities.length > 0;
  document.getElementById('uploadDropzone').style.display = has ? 'none' : 'block';
  document.getElementById('dashboardSection').style.display = has ? 'block' : 'none';
  document.getElementById('btnClear').style.display = has ? 'inline-flex' : 'none';
  if (has) { computePMC(); buildPMCChart(); renderTrainingTable(); initCompareDefaults(); }
  loadSavedPlan();
  processPendingFits();
  // Load Strava tokens on first dashboard load
  if (typeof loadStravaTokens === 'function' && currentUser && !stravaTokens) loadStravaTokens();
}

function recalcAll() {
  for (const a of allActivities) { const t = computeTSS(a); a.tss = t.tss; a.intensityFactor = t.intensityFactor; }
  refreshDashboard();
  if (typeof saveSettings === 'function') saveSettings();
}

async function clearAll() {
  if (!confirm('Clear all imported activities?')) return;
  if (typeof deleteAllActivities === 'function' && currentUser) await deleteAllActivities();
  allActivities = []; pmcResult = {}; plannerInited = false;
  if (pmcChart) { pmcChart.destroy(); pmcChart = null; }
  if (compareChart) { compareChart.destroy(); compareChart = null; }
  if (plannerChart) { plannerChart.destroy(); plannerChart = null; }
  document.getElementById('uploadDropzone').style.display = 'block';
  document.getElementById('dashboardSection').style.display = 'none';
  document.getElementById('btnClear').style.display = 'none';
  document.getElementById('debugPanel').innerHTML = '';
}

// Drag & Drop
function onDragOver(e) { e.preventDefault(); const el = document.getElementById('uploadDropzone'); el.classList.add('drag-active'); }
function onDragLeave(e) { e.preventDefault(); const el = document.getElementById('uploadDropzone'); el.classList.remove('drag-active'); }
function onDrop(e) { e.preventDefault(); const el = document.getElementById('uploadDropzone'); el.classList.remove('drag-active'); handleFiles(e.dataTransfer.files); }

// UI
function toggleSettings() { document.getElementById('settingsPanel').classList.toggle('is-open'); }
function toggleDebug() { document.getElementById('debugPanel').classList.toggle('is-open'); }
function showToast(msg, icon = 'ℹ️') { const el = document.createElement('div'); el.className = 'toast-notification'; el.innerHTML = `<span>${icon}</span> ${msg}`; document.body.appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2500); setTimeout(() => el.remove(), 3000); }


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
  console.log('importPlanJson called', fileList, fileList.length);
  const file = fileList[0];
  if (!file) { console.log('No file selected'); return; }
  console.log('Reading file:', file.name, file.size);
  const reader = new FileReader();
  reader.onload = function(e) {
    console.log('FileReader loaded, length:', e.target.result.length);
    try {
      trainingPlan = JSON.parse(e.target.result);
      console.log('Plan parsed OK, weeks:', trainingPlan.weeks?.length);
      renderTrainingPlan();
      showToast('Training plan loaded', '✅');
      // Auto-add race date from plan if not already set
      if (trainingPlan.race_date && raceDates.length === 0) {
        // Try to parse race_date like "First weekend of May 2026"
        const rd = trainingPlan.race_date;
        const yearMatch = rd.match(/(20\d{2})/);
        const monthMatch = rd.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i);
        if (yearMatch && monthMatch) {
          const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
          const mo = months[monthMatch[0].toLowerCase()];
          // Default to first Saturday of that month
          const firstDay = new Date(+yearMatch[1], parseInt(mo)-1, 1);
          let sat = new Date(firstDay);
          while (sat.getDay() !== 6) sat.setDate(sat.getDate() + 1);
          raceDates.push({ date: sat.toISOString().slice(0, 10), name: trainingPlan.race || 'Race' });
          renderRaceDateInputs();
          saveRaceDates();
        }
      }
      document.getElementById('btnImportZwo').style.display = 'inline-flex';
      if (typeof saveTrainingPlan === 'function') saveTrainingPlan(trainingPlan);
    } catch(err) {
      console.error('JSON parse error:', err);
      showToast('Invalid JSON file', '❌');
    }
  };
  reader.onerror = function(err) { console.error('FileReader error:', err); };
  reader.readAsText(file);
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
  document.getElementById('planZwoInput').value = '';
  setTimeout(() => {
    showToast(`${Object.keys(zwoFiles).length} ZWO files loaded`, '✅');
    document.getElementById('btnDownloadAllZwo').style.display = 'inline-flex';
    renderTrainingPlan();
    if (typeof saveZwoFiles === 'function') saveZwoFiles(zwoFiles);
  }, 500);
}

function toggleSessionComplete(sessionId) {
  if (planCompletions[sessionId]) delete planCompletions[sessionId];
  else planCompletions[sessionId] = true;
  renderTrainingPlan();
  if (typeof savePlanCompletions === 'function') savePlanCompletions(planCompletions);
}

function isWeekCurrent(dateStr, now) {
  // Parse "Feb 23 – Mar 1" or "Apr 6 – Apr 12"
  if (!dateStr) return false;
  const parts = dateStr.split('–').map(s => s.trim());
  if (parts.length < 2) return false;
  const year = now.getFullYear();
  const parseWeekDate = (str) => {
    const d = new Date(str + ' ' + year);
    if (!isNaN(d)) return d;
    return new Date(str + ', ' + year);
  };
  const start = parseWeekDate(parts[0]);
  const end = parseWeekDate(parts[1]);
  if (isNaN(start) || isNaN(end)) return false;
  // Handle year wrap (e.g. Dec – Jan): if end < start, end is next year
  if (end < start) end.setFullYear(end.getFullYear() + 1);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  const today = new Date(now); today.setHours(12, 0, 0, 0);
  return today >= start && today <= end;
}

function scrollToCurrentWeek() {
  const el = document.querySelector('.plan-week-current');
  if (el) {
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }
}

function renderTrainingPlan() {
  if (!trainingPlan) return;
  const p = trainingPlan;
  document.getElementById('planEmpty').style.display = 'none';
  document.getElementById('planContent').style.display = 'block';

  // Header
  const cal = p.calibration || {};
  document.getElementById('planHeader').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px">
      <div>
        <div style="font-size:20px;font-weight:700;color:var(--text-primary)">${p.race || 'Training Plan'}</div>
        <div style="font-size:14px;color:var(--text-muted);margin-top:4px">${p.athlete || ''} · ${p.race_date || ''} · ${p.plan_version || ''}</div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${cal.ftp_watts ? `<div class="plan-cal-chip">FTP <strong>${cal.ftp_watts}W</strong></div>` : ''}
        ${cal.run_race_target_pace ? `<div class="plan-cal-chip">Run Target <strong>${cal.run_race_target_pace}</strong></div>` : ''}
        ${cal.bike_race_target_np ? `<div class="plan-cal-chip">Bike Target <strong>${cal.bike_race_target_np}</strong></div>` : ''}
        ${cal.swim_target ? `<div class="plan-cal-chip">Swim Target <strong>${cal.swim_target}</strong></div>` : ''}
      </div>
    </div>
    ${(p.structure_corrections || []).length ? `<div style="margin-top:12px;font-size:13px;color:var(--text-dim)">${p.structure_corrections.map(c => '• ' + c).join('<br>')}</div>` : ''}
  `;

  // Zones
  if (p.zones) {
    let zh = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    if (p.zones.bike) {
      zh += '<div><div style="font-weight:600;margin-bottom:8px;color:var(--color-blue)">🚴 Bike Zones (FTP: ' + p.zones.bike.ftp + 'W)</div>';
      zh += '<table class="zone-table"><tr><th>Zone</th><th>Name</th><th>Power</th><th>%FTP</th></tr>';
      for (const [zk, zv] of Object.entries(p.zones.bike)) {
        if (zk === 'ftp') continue;
        zh += `<tr><td>${zk}</td><td>${zv.name}</td><td>${zv.power || ''}</td><td>${zv.ratio || ''}</td></tr>`;
      }
      zh += '</table></div>';
    }
    if (p.zones.run) {
      zh += '<div><div style="font-weight:600;margin-bottom:8px;color:var(--color-green)">🏃 Run Zones</div>';
      zh += '<table class="zone-table"><tr><th>Zone</th><th>Name</th><th>Pace</th><th>HR</th></tr>';
      for (const [zk, zv] of Object.entries(p.zones.run)) {
        zh += `<tr><td>${zk}</td><td>${zv.name}</td><td>${zv.pace || ''}</td><td>${zv.hr || ''}</td></tr>`;
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
  let currentWeekIdx = -1;
  const now = new Date();
  for (let wi = 0; wi < (p.weeks || []).length; wi++) {
    const week = p.weeks[wi];
    const phaseBg = week.color || '#1e2030';
    // Detect current week from dates like "Apr 6 – Apr 12"
    const isCurrentWeek = isWeekCurrent(week.dates, now);
    if (isCurrentWeek) currentWeekIdx = wi;
    wh += `<div class="plan-week-card${isCurrentWeek ? ' plan-week-current' : ''}" data-plan-week="${wi}" id="plan-week-${wi}">`;
    wh += `<div class="plan-week-header" style="border-left:4px solid ${isCurrentWeek ? 'var(--color-blue)' : phaseBg}">`;
    wh += `<div><span class="plan-week-num">W${week.week}</span> <span class="plan-week-phase" style="color:${phaseBg}">${week.phase}</span></div>`;
    wh += `<div style="display:flex;align-items:center;gap:12px"><span style="font-size:13px;color:var(--text-dim)">${week.dates}</span><span class="plan-week-tss">TSS ${week.tss}</span></div>`;
    wh += `</div>`;
    if (week.note) wh += `<div class="plan-week-note">${week.note}</div>`;
    wh += `<div class="plan-sessions">`;
    for (const s of (week.sessions || [])) {
      const sc = sportColors[s.sport] || '#6b7280';
      const se = sportEmojis[s.sport] || '🏋️';
      const hasFile = s.zwo_file && (hasZwo ? zwoFiles[s.zwo_file] : true);
      const isDone = planCompletions[s.id];
      wh += `<div class="plan-session${isDone ? ' plan-session-done' : ''}">`;
      wh += `<div class="plan-session-check"><input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleSessionComplete('${s.id}')" style="cursor:pointer;width:16px;height:16px;accent-color:var(--color-green)"></div>`;
      wh += `<div class="plan-session-day">${s.day.slice(0, 3)}</div>`;
      wh += `<div class="plan-session-body">`;
      wh += `<div class="plan-session-top"><span class="plan-session-sport" style="background:${sc}22;color:${sc}">${se} ${s.sport}</span>`;
      wh += `<span class="plan-session-name">${s.name}</span>`;
      wh += `<span class="plan-session-tss">TSS ${s.tss}</span>`;
      if (s.zwo_file && hasZwo && zwoFiles[s.zwo_file]) {
        wh += `<button class="plan-zwo-btn" onclick="downloadZwo('${s.zwo_file}')">⬇ .zwo</button>`;
      } else if (s.zwo_file && !hasZwo) {
        wh += `<span class="plan-zwo-pending" title="Import ZWO files to enable download">📄 .zwo</span>`;
      }
      wh += `</div>`;
      wh += `<div class="plan-session-desc">${s.description}</div>`;
      wh += `</div></div>`;
    }
    wh += `</div></div>`;
  }
  document.getElementById('planWeeks').innerHTML = wh;

  // Auto-scroll to current week
  scrollToCurrentWeek();
}

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

async function processPendingFits() {
  if (typeof loadPendingFits !== 'function') return;
  const pending = await loadPendingFits();
  if (!pending.length) return;
  
  showToast(`Processing ${pending.length} emailed FIT file${pending.length > 1 ? 's' : ''}...`, '📧');
  let n = 0;
  
  for (const pf of pending) {
    try {
      // Decode base64 to ArrayBuffer
      const binary = atob(pf.fitBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const buf = bytes.buffer;
      
      const parsed = parseFitFile(buf);
      const tssInfo = computeTSS(parsed);
      const act = { ...parsed, tss: tssInfo.tss, intensityFactor: tssInfo.intensityFactor, fileName: pf.fileName || 'email.fit' };
      
      const isDup = allActivities.some(a => Math.abs(a.startDate.getTime() - act.startDate.getTime()) < 60000 && a.sport === act.sport);
      if (!isDup) {
        if (typeof saveActivity === 'function' && currentUser) {
          const docId = await saveActivity(act);
          act.id = docId;
        }
        allActivities.push(act);
        n++;
        log(`  ✓ [email] ${act.sport} ${fmtDate(act.startDate)} TSS=${act.tss}`, 'ok');
      }
      
      // Mark as processed
      await markPendingFitProcessed(pf.id);
    } catch(e) {
      console.error('Error processing emailed FIT:', e);
      log(`  ✗ [email] ${pf.fileName}: ${e.message}`, 'err');
    }
  }
  
  if (n > 0) {
    showToast(`Imported ${n} emailed activit${n > 1 ? 'ies' : 'y'}`, '📧');
    refreshDashboard();
  }
}

async function loadSavedPlan() {
  if (typeof loadTrainingPlan === 'function') {
    const saved = await loadTrainingPlan();
    if (saved) { trainingPlan = saved; renderTrainingPlan(); document.getElementById('btnImportZwo').style.display = 'inline-flex'; }
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
  // Ensure plan file inputs work
  const pji = document.getElementById('planJsonInput');
  if (pji) pji.addEventListener('change', function() { importPlanJson(this.files); });
  const pzi = document.getElementById('planZwoInput');
  if (pzi) pzi.addEventListener('change', function() { importZwoFiles(this.files); });
});
