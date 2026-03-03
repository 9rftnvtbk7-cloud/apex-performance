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
let plannerInited = false;

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
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('is-active'));
  btn.classList.add('is-active');
  document.getElementById('tab-' + tabId).classList.add('is-active');
  if (tabId === 'compare') renderComparison();
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
  document.getElementById('valTotalTss').textContent = allActivities.reduce((s, a) => s + (a.tss || 0), 0).toLocaleString();
  document.getElementById('subTotalTss').textContent = `Across ${allActivities.length} activities`;
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
  const aL = [...mL]; for (const l of fL) if (!aL.includes(l)) aL.push(l);
  const pad = a => { const o = [...a]; while (o.length < aL.length) o.push(null); return o; };
  const padF = a => { const si = aL.indexOf(fL[0]); const o = new Array(aL.length).fill(null); for (let i = 0; i < a.length; i++) if (si + i < o.length) o[si + i] = a[i]; return o; };
  pmcChart = new Chart(ctx, {
    type: 'line',
    data: { labels: aL, datasets: [
      { label: 'CTL (Fitness)', data: pad(pmcResult.ctlVals || []), borderColor: '#3b82f6', borderWidth: 2.5, pointRadius: 0, pointHitRadius: 6, tension: 0.3, fill: false, order: 2, spanGaps: true },
      { label: 'ATL (Fatigue)', data: pad(pmcResult.atlVals || []), borderColor: '#f43f5e', borderWidth: 2, pointRadius: 0, pointHitRadius: 6, tension: 0.3, fill: false, order: 3, spanGaps: true },
      { label: 'TSB (Form)', data: pad(pmcResult.tsbVals || []), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.06)', borderWidth: 1.5, pointRadius: 0, pointHitRadius: 6, tension: 0.3, fill: true, order: 4, spanGaps: true },
      { label: 'TSS', data: pad(pmcResult.tssVals || []), borderColor: 'rgba(245,158,11,0.7)', backgroundColor: 'rgba(245,158,11,0.5)', pointRadius: 4, pointHoverRadius: 7, showLine: false, order: 1, yAxisID: 'y1', spanGaps: false },
      { label: 'CTL Forecast', data: padF(fc.ctl || []), borderColor: 'rgba(59,130,246,0.4)', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, tension: 0.3, order: 5, spanGaps: false },
      { label: 'ATL Forecast', data: padF(fc.atl || []), borderColor: 'rgba(244,63,94,0.3)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, order: 6, spanGaps: false },
      { label: 'TSB Forecast', data: padF(fc.tsb || []), borderColor: 'rgba(16,185,129,0.3)', borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, order: 7, spanGaps: false },
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
function setChartRange(r, btn) { document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('is-active')); btn.classList.add('is-active'); if (!pmcChart) return; if (r === 'all') { pmcChart.options.scales.x.min = undefined; pmcChart.options.scales.x.max = undefined; } else { const ls = pmcChart.data.labels, td = new Date(); td.setHours(0, 0, 0, 0); const sl = new Date(td.getTime() - r * 86400000).toISOString().slice(0, 10); let mi = ls.findIndex(l => l >= sl); if (mi < 0) mi = 0; pmcChart.options.scales.x.min = ls[mi]; pmcChart.options.scales.x.max = ls[ls.length - 1]; } pmcChart.update(); }

// ══════════════════════════════════════════════
// Comparison
// ══════════════════════════════════════════════
function initCompareDefaults() {
  if (!allActivities.length) return;
  const sorted = [...allActivities].sort((a, b) => a.startDate - b.startDate);
  document.getElementById('compareFrom').value = sorted[0].startDate.toISOString().slice(0, 10);
  document.getElementById('compareTo').value = new Date().toISOString().slice(0, 10);
  const sports = [...new Set(allActivities.map(a => a.sport))].sort();
  document.getElementById('compareSport').innerHTML = '<option value="all">All Sports</option>' + sports.map(s => `<option value="${s}">${fmtSportName(s)}</option>`).join('');
}

function renderComparison() {
  if (!allActivities.length) return;
  const grouping = document.getElementById('compareGrouping').value;
  const fromStr = document.getElementById('compareFrom').value;
  const toStr = document.getElementById('compareTo').value;
  const sportFilter = document.getElementById('compareSport').value;
  if (!fromStr || !toStr) return;
  const from = new Date(fromStr + 'T00:00:00'), to = new Date(toStr + 'T23:59:59');
  let filtered = allActivities.filter(a => a.startDate >= from && a.startDate <= to);
  if (sportFilter !== 'all') filtered = filtered.filter(a => a.sport === sportFilter);
  const periods = {};
  for (const a of filtered) {
    const key = getPeriodKey(a.startDate, grouping);
    if (!periods[key]) periods[key] = { label: key, tss: 0, duration: 0, distance: 0, count: 0, hrs: [], ifs: [], powers: [] };
    const p = periods[key]; p.tss += (a.tss || 0); p.duration += (a.duration || 0); p.distance += (a.distance || 0); p.count++;
    if (a.avgHr) p.hrs.push(a.avgHr); if (a.intensityFactor) p.ifs.push(a.intensityFactor); if (a.avgPower) p.powers.push(a.avgPower);
  }
  const sp = Object.values(periods).sort((a, b) => a.label.localeCompare(b.label));
  const labels = sp.map(p => formatPeriodLabel(p.label, grouping));
  const metrics = [
    { label: 'Total TSS', values: sp.map(p => p.tss), fmt: v => v.toLocaleString(), color: 'var(--color-amber)' },
    { label: 'Total Time', values: sp.map(p => p.duration), fmt: v => fmtDuration(v), color: 'var(--color-blue)' },
    { label: 'Total Distance', values: sp.map(p => p.distance), fmt: v => (v / 1000).toFixed(1) + ' km', color: 'var(--color-green)' },
    { label: 'Activities', values: sp.map(p => p.count), fmt: v => v.toString(), color: 'var(--color-purple)' },
    { label: 'Avg IF', values: sp.map(p => p.ifs.length ? +(p.ifs.reduce((a, b) => a + b, 0) / p.ifs.length).toFixed(2) : 0), fmt: v => v.toFixed(2), color: 'var(--color-cyan)' },
    { label: 'Avg HR', values: sp.map(p => p.hrs.length ? Math.round(p.hrs.reduce((a, b) => a + b, 0) / p.hrs.length) : 0), fmt: v => v + ' bpm', color: 'var(--color-red)' },
  ];
  document.getElementById('compareMetrics').innerHTML = metrics.map(m => {
    const vals = m.values, latest = vals.length ? vals[vals.length - 1] : 0, prev = vals.length > 1 ? vals[vals.length - 2] : 0;
    const delta = prev > 0 ? ((latest - prev) / prev * 100) : 0, avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return `<div class="compare-metric-card"><div class="compare-metric-label">${m.label}</div><div class="compare-period-row"><span class="compare-period-label">Latest</span><span class="compare-period-value" style="color:${m.color}">${m.fmt(latest)}${delta !== 0 ? `<span class="compare-delta ${delta > 0 ? 'pos' : 'neg'}">${delta > 0 ? '+' : ''}${delta.toFixed(0)}%</span>` : ''}</span></div><div class="compare-period-row"><span class="compare-period-label">Previous</span><span class="compare-period-value">${m.fmt(prev)}</span></div><div class="compare-period-row"><span class="compare-period-label">Average</span><span class="compare-period-value" style="color:var(--text-dim)">${m.fmt(Math.round(avg))}</span></div></div>`;
  }).join('');
  if (compareChart) compareChart.destroy();
  compareChart = new Chart(document.getElementById('compareChart').getContext('2d'), {
    type: 'bar', data: { labels, datasets: [
      { label: 'TSS', data: metrics[0].values, backgroundColor: 'rgba(245,158,11,0.7)', borderRadius: 4, yAxisID: 'y' },
      { label: 'Hours', data: sp.map(p => +(p.duration / 3600).toFixed(1)), backgroundColor: 'rgba(59,130,246,0.6)', borderRadius: 4, yAxisID: 'y1' },
    ]}, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: true, labels: { color: '#8b8fa4' } }, tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#8b8fa4', padding: 12, cornerRadius: 8 } }, scales: { x: { grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#5a5e74', maxRotation: 45 } }, y: { position: 'left', grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: 'rgba(245,158,11,0.7)' }, title: { display: true, text: 'TSS', color: 'rgba(245,158,11,0.7)' } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: 'rgba(59,130,246,0.7)' }, title: { display: true, text: 'Hours', color: 'rgba(59,130,246,0.7)' }, min: 0 } } }
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

function plannerPreset(type) {
  const ct = pmcResult.lastCtl ? Math.round(pmcResult.lastCtl * 7) : 350;
  switch (type) {
    case 'maintain': plannerData.forEach(p => p.tss = ct); break;
    case 'build': plannerData.forEach((p, i) => { const bl = Math.floor(i / 4), wk = i % 4, base = ct + bl * 40; p.tss = wk === 3 ? Math.round(base * 0.6) : Math.round(base + wk * 20); }); break;
    case 'taper': plannerData.forEach((p, i) => p.tss = Math.round(ct * Math.pow(0.92, i))); break;
    case 'polarized': plannerData.forEach((p, i) => { const w = i % 3; p.tss = w === 0 ? Math.round(ct * 1.3) : w === 1 ? Math.round(ct * 0.7) : Math.round(ct * 1.1); }); break;
    case 'clear': plannerData.forEach(p => p.tss = 0); break;
  }
  renderPlannerGrid(); updatePlannerForecast();
  if (typeof savePlannerData === 'function') savePlannerData();
}

function updatePlannerForecast() {
  let ctl = pmcResult.lastCtl || 0, atl = pmcResult.lastAtl || 0;
  const labels = ['Today'], ctlV = [+ctl.toFixed(1)], atlV = [+atl.toFixed(1)], tsbV = [+(ctl - atl).toFixed(1)];
  for (const week of plannerData) { const dt = week.tss / 7; for (let d = 0; d < 7; d++) { ctl += (dt - ctl) / 42; atl += (dt - atl) / 7; } labels.push(week.weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })); ctlV.push(+ctl.toFixed(1)); atlV.push(+atl.toFixed(1)); tsbV.push(+(ctl - atl).toFixed(1)); }
  document.getElementById('planCtl').textContent = ctl.toFixed(1);
  document.getElementById('planAtl').textContent = atl.toFixed(1);
  const tsb = ctl - atl; document.getElementById('planTsb').textContent = tsb.toFixed(1); document.getElementById('planTsb').style.color = tsb >= 0 ? 'var(--color-green)' : 'var(--color-red)';
  if (plannerChart) plannerChart.destroy();
  plannerChart = new Chart(document.getElementById('plannerChart').getContext('2d'), {
    type: 'line', data: { labels, datasets: [
      { label: 'CTL (Fitness)', data: ctlV, borderColor: '#3b82f6', borderWidth: 2.5, pointRadius: 3, pointBackgroundColor: '#3b82f6', tension: 0.3, fill: false },
      { label: 'ATL (Fatigue)', data: atlV, borderColor: '#f43f5e', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#f43f5e', tension: 0.3, fill: false },
      { label: 'TSB (Form)', data: tsbV, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 1.5, pointRadius: 3, pointBackgroundColor: '#10b981', tension: 0.3, fill: true },
    ]}, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: true, labels: { color: '#8b8fa4', usePointStyle: true, pointStyle: 'line' } }, tooltip: { backgroundColor: '#1e2030', borderColor: '#2a2d3e', borderWidth: 1, titleColor: '#e8eaf0', bodyColor: '#8b8fa4', padding: 12, cornerRadius: 8 } }, scales: { x: { grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#5a5e74', maxRotation: 45 } }, y: { grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#5a5e74' }, title: { display: true, text: 'CTL / ATL / TSB', color: '#5a5e74' } } } }
  });
}

// ══════════════════════════════════════════════
// Training Table
// ══════════════════════════════════════════════
function renderTrainingTable() {
  const sorted = [...allActivities].sort((a, b) => { const k = sortConfig.key; let va, vb; if (k === 'date') { va = a.startDate?.getTime() || 0; vb = b.startDate?.getTime() || 0; } else if (k === 'sport') { va = a.sport || ''; vb = b.sport || ''; } else { va = a[k] || 0; vb = b[k] || 0; } if (typeof va === 'string') return sortConfig.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va); return sortConfig.dir === 'asc' ? va - vb : vb - va; });
  document.getElementById('tableBody').innerHTML = sorted.map(a => `<tr><td class="cell-mono">${fmtDate(a.startDate)}</td><td><span class="sport-tag sport-tag--${sportTagClass(a.sport)}">${sportEmoji(a.sport)} ${fmtSportName(a.sport)}</span></td><td class="cell-mono">${fmtDuration(a.duration)}</td><td class="cell-mono">${fmtDist(a.distance, a.sport)}</td><td class="cell-tss">${a.tss || '—'}</td><td class="cell-mono">${a.intensityFactor ? a.intensityFactor.toFixed(2) : '—'}</td><td class="cell-mono">${a.avgHr ? a.avgHr + ' bpm' : '—'}</td><td class="cell-mono">${a.avgPower ? a.avgPower + 'w' : '—'}</td><td class="cell-mono">${a.calories ? a.calories.toLocaleString() : '—'}</td></tr>`).join('');
  document.getElementById('activityCount').textContent = `${allActivities.length} activit${allActivities.length === 1 ? 'y' : 'ies'}`;
  document.querySelectorAll('.training-table th').forEach(th => { const ok = th.dataset.col === sortConfig.key; th.classList.toggle('is-sorted', ok); const ar = th.querySelector('.sort-indicator'); if (ar) ar.textContent = (ok && sortConfig.dir === 'asc') ? '▲' : '▼'; });
}
function sortColumn(k) { sortConfig = { key: k, dir: (sortConfig.key === k && sortConfig.dir === 'desc') ? 'asc' : 'desc' }; renderTrainingTable(); }

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
function onDragOver(e) { e.preventDefault(); document.getElementById('uploadDropzone').classList.add('drag-active'); }
function onDragLeave(e) { e.preventDefault(); document.getElementById('uploadDropzone').classList.remove('drag-active'); }
function onDrop(e) { e.preventDefault(); document.getElementById('uploadDropzone').classList.remove('drag-active'); handleFiles(e.dataTransfer.files); }

// UI
function toggleSettings() { document.getElementById('settingsPanel').classList.toggle('is-open'); }
function toggleDebug() { document.getElementById('debugPanel').classList.toggle('is-open'); }
function showToast(msg, icon = 'ℹ️') { const el = document.createElement('div'); el.className = 'toast-notification'; el.innerHTML = `<span>${icon}</span> ${msg}`; document.body.appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2500); setTimeout(() => el.remove(), 3000); }

// Init auth on page load
document.addEventListener('DOMContentLoaded', () => {
  if (typeof initAuth === 'function') initAuth();
});
