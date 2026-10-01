// ══════════════════════════════════════════════
// Season › Insights
// ══════════════════════════════════════════════
// Cards, most actionable first:
//   Training status  : productive / maintaining / overreaching / detraining / tapering (from CTL, ATL, TSB)
//   Race readiness   : next race — projected fitness and form, long run and climbing vs the race, time estimate
//   Running load     : last 7 days vs the previous 4 weeks (distance, climbing) — injury guard
//   Intensity        : time in HR zones (selectable window), 80/20 split, weekly zones, easy sessions over their cap
//   Thresholds       : estimated FTP (power curve) and LTHR (best 20/60-min heart rate of runs)
//   Aerobic fitness  : efficiency (output per heartbeat) and drift on long easy sessions
//   Recent bests     : new all-time / 12-month bests in the last 28 days
//   Best efforts     : power / pace curve for a period vs all-time
// The calculations are plain functions (tested in tests/app.test.mjs); render* functions only draw.

let bestEffortsChart = null;
let insZonesChart = null;
let insAerobicChart = null;
let insightsWindow = 28;     // days for the time-in-zones bars
let insightsAerobicKind = 'run';

// Zone colours are tokens (--zone-1 … --zone-7 in styles.css)
const zoneVar = i => `var(--zone-${i + 1})`;
const zoneColor = i => (typeof cssVar === 'function' && cssVar(`--zone-${i + 1}`)) || '#888';

function fmtHours(sec) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`; }
function fmtMmDuration(d) { d = +d; return d < 60 ? `${d}s` : d < 3600 ? `${d / 60}min` : `${d / 3600}h`; }
function fmtPaceFromSpeed(mps) { if (!(mps > 0)) return '—'; const s = Math.round(1000 / mps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`; }
function fmtSigned(v, digits = 1) { return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`; }
function fmtShortDate(d) { return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''; }
function dayStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
// Running only (walks and hikes are "run" for TSS, but not for running load or race readiness)
function isRunning(s) { return ['running', 'trail_running'].includes(s); }

// Horizontal stacked bar + legend for seconds per zone
function zoneBarHtml(title, names, secs) {
  const total = secs.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const segs = secs.map((s, i) => s ? `<span style="width:${(s / total * 100).toFixed(2)}%;background:${zoneVar(i)}" title="${escapeHtml(names[i])}: ${fmtHours(s)}"></span>` : '').join('');
  const legend = secs.map((s, i) => `<span class="zone-legend-item"><i style="background:${zoneVar(i)}"></i>${escapeHtml(names[i].split(' ')[0])} ${fmtHours(s)} <small>${Math.round(s / total * 100)}%</small></span>`).join('');
  return `<div class="zone-block"><div class="zone-block-title">${escapeHtml(title)} <small>${fmtHours(total)}</small></div><div class="zone-bar" role="img" aria-label="${escapeHtml(title)}">${segs}</div><div class="zone-legend">${legend}</div></div>`;
}

// ── Calculations ──

// The first race on or after `today`
function nextRace(today, races = raceDates) {
  return (races || []).map(r => ({ name: r.name || 'Race', date: parseIsoDate(r.date) })).filter(r => r.date && r.date >= today).sort((a, b) => a.date - b.date)[0] || null;
}

// Training status from the fitness series (like Garmin's): one label, a tone and the reason in plain words
function trainingStatus(series = pmcResult, now = new Date(), races = raceDates) {
  const ctlV = series.ctlVals || [], n = ctlV.length;
  if (n < 29 || !(series.lastCtl >= 5)) return { key: 'start', label: 'Building history', tone: 'ctl', reason: 'Needs about 4 weeks of training to say how your fitness is moving.' };
  const ctl = series.lastCtl, atl = series.lastAtl, tsb = ctl - atl;
  const ramp = ctl - ctlV[n - 8], change28 = ctl - ctlV[n - 29], ratio = atl / ctl;
  const facts = { ctl, ramp, change28, ratio, tsb };
  const race = nextRace(dayStart(now), races);
  const daysToRace = race ? Math.round((race.date - dayStart(now)) / 86400000) : null;
  if (race && daysToRace <= 21 && ramp <= 0.5 && tsb > -10)
    return { ...facts, key: 'taper', label: 'Tapering', tone: 'ok', reason: `Fatigue is coming down ${daysToRace} days before ${race.name}; fitness ${fmtSigned(change28)} over 4 weeks.` };
  if (ratio > 1.5) return { ...facts, key: 'over', label: 'Overreaching', tone: 'missed', reason: `Your load this week is ${ratio.toFixed(1)}× your usual. Above 1.5 the injury risk rises: plan a few easier days.` };
  if (ramp > 8) return { ...facts, key: 'over', label: 'Overreaching', tone: 'missed', reason: `Fitness is rising ${ramp.toFixed(1)} a week; more than about 8 is hard to absorb.` };
  if (ramp >= 1) return { ...facts, key: 'productive', label: 'Productive', tone: 'ok', reason: `Fitness ${fmtSigned(ramp)} this week and ${fmtSigned(change28)} over 4 weeks, with load at ${ratio.toFixed(1)}× your usual.` };
  if (ramp <= -2 && change28 <= -4) return { ...facts, key: 'detraining', label: 'Detraining', tone: 'partial', reason: `Fitness ${fmtSigned(change28)} over 4 weeks: training has been lighter than your usual for a while.` };
  if (ramp < -1) return { ...facts, key: 'recovering', label: 'Recovering', tone: 'ctl', reason: `Fitness ${fmtSigned(ramp)} this week while fatigue drops (form ${fmtSigned(tsb, 0)}).` };
  return { ...facts, key: 'maintaining', label: 'Maintaining', tone: 'ctl', reason: `Fitness steady (${fmtSigned(ramp)} this week, ${fmtSigned(change28)} over 4 weeks). Add load to keep improving.` };
}

// Race distance and climbing read from the race or plan name, e.g. "Trail de Saint-Nolff (30km / D+600m)"
function raceDemands(race, plan = trainingPlan) {
  const texts = [race && race.name, plan && plan.race, plan && plan.name].filter(Boolean).map(String);
  let km = null, dplus = null;
  for (const t of texts) {
    if (km == null) { const m = t.match(/(\d+(?:[.,]\d+)?)\s*km\b/i) || t.match(/(\d+(?:[.,]\d+)?)\s*K\b/); if (m) km = parseFloat(m[1].replace(',', '.')); }
    if (dplus == null) { const m = t.match(/D\+\s*(\d+)/i) || t.match(/(\d+)\s*m\s*D\+/i); if (m) dplus = +m[1]; }
  }
  return { km, dplus };
}

// Rolling 7-day windows of running, newest first ([0] = the last 7 days including today)
function runWeeks(activities, now = new Date(), n = 8) {
  const end = addDays(dayStart(now), 1), weeks = [];
  for (let i = 0; i < n; i++) {
    const to = addDays(end, -7 * i), from = addDays(to, -7);
    const runs = activities.filter(a => isRunning(a.sport) && a.startDate >= from && a.startDate < to);
    weeks.push({
      from, to: addDays(to, -1), count: runs.length,
      km: runs.reduce((s, a) => s + (a.distance || 0), 0) / 1000,
      dplus: runs.reduce((s, a) => s + (a.elevationGain || 0), 0),
      tss: runs.reduce((s, a) => s + (a.tss || 0), 0),
      longest: runs.reduce((m, a) => (a.distance || 0) > (m ? m.distance || 0 : -1) ? a : m, null),
    });
  }
  return weeks;
}

// Injury guard: the last 7 days of running against the average of the 4 weeks before
function runLoadGuard(activities, now = new Date()) {
  const w = runWeeks(activities, now, 8), prev = w.slice(1, 5);
  const avg = k => prev.reduce((s, x) => s + x[k], 0) / prev.length;
  const ratio = k => avg(k) > 0 ? w[0][k] / avg(k) : null;
  const kmRatio = ratio('km'), dplusRatio = ratio('dplus');
  const worst = Math.max(kmRatio || 0, dplusRatio || 0);
  const level = !prev.some(x => x.km > 0) ? 'none' : worst > 1.5 ? 'high' : worst > 1.3 ? 'caution' : 'ok';
  const what = (dplusRatio || 0) > (kmRatio || 0) ? `climbing ${Math.round(w[0].dplus)} m vs ${Math.round(avg('dplus'))} m a week` : `distance ${w[0].km.toFixed(1)} km vs ${avg('km').toFixed(1)} km a week`;
  const message = {
    none: 'Needs a few weeks of running to compare against.',
    high: `Last 7 days: ${what} before — ${worst.toFixed(1)}× your usual. Knees and ankles adapt slower than fitness: hold or reduce next week.`,
    caution: `Last 7 days: ${what} before (${worst.toFixed(1)}×). Keep the next week at this level rather than adding more.`,
    ok: `Running load is in line with the last 4 weeks (${(kmRatio || 0).toFixed(1)}× distance, ${(dplusRatio || 0).toFixed(1)}× climbing).`,
  }[level];
  return { weeks: w, avgKm: avg('km'), avgDplus: avg('dplus'), kmRatio, dplusRatio, level, message };
}

// Fitness and form on a future date, following Season › Forecast like the Today chart
function projectFitnessTo(date, now = new Date(), series = pmcResult) {
  const today = dayStart(now), days = Math.round((dayStart(date) - today) / 86400000);
  if (days < 0 || series.lastCtl == null) return null;
  const plan = typeof forecastFromSeasonPlan === 'function' ? forecastFromSeasonPlan(today) : null;
  const input = document.getElementById('inputForecastTss');
  const avg = +(input && input.value) || Math.round(series.lastCtl);
  let c = series.lastCtl, a = series.lastAtl;
  for (let i = 1; i < days; i++) { const t = plan ? plan.tssOn(addDays(today, i), avg) : avg; c += (t - c) / 42; a += (t - a) / 7; }
  return { ctl: c, tsb: c - a, fromPlan: !!plan }; // race morning: the load of race day itself not yet counted
}

// Trail race time from the best recent run, scaled with Riegel (exponent 1.06) on "km-effort" (km + D+/100)
function estimateRaceTime(activities, demands, now = new Date(), days = 60) {
  if (!demands || !(demands.km > 0)) return null;
  const target = demands.km + (demands.dplus || 0) / 100, since = addDays(dayStart(now), -days);
  let best = null;
  for (const a of activities) {
    if (!isRunning(a.sport) || a.startDate < since || a.startDate > now || !(a.distance >= 5000) || !(a.duration >= 1500)) continue;
    const effort = a.distance / 1000 + (a.elevationGain || 0) / 100;
    const seconds = a.duration * Math.pow(target / effort, 1.06);
    if (!best || seconds < best.seconds) best = { seconds, activity: a };
  }
  return best;
}

// Estimated LTHR: best 20-min (×0.98) or 60-min heart rate of runs in `days` days;
// without detailed data, the highest average heart rate of a 20–75 min run (rougher)
function estimateLthr(activities, now = new Date(), days = 90) {
  const since = new Date(now.getTime() - days * 86400000);
  const runs = activities.filter(a => isRunning(a.sport) && a.startDate >= since && a.startDate <= now);
  const c = bestCurve(runs, 'mmHr');
  const fromStreams = Math.max((c[1200] || 0) * 0.98, c[3600] || 0);
  if (fromStreams > 0) return { value: Math.round(fromStreams), source: 'streams' };
  const best = runs.filter(a => a.avgHr > 0 && a.duration >= 1200 && a.duration <= 4500).reduce((m, a) => Math.max(m, a.avgHr), 0);
  return best > 0 ? { value: Math.round(best), source: 'summary' } : null;
}

// Seconds per HR zone for each Monday-based week, oldest first
function weeklyHrZones(activities, now = new Date(), weeks = 12) {
  const today = dayStart(now), monday = addDays(today, -((today.getDay() + 6) % 7)), out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = addDays(monday, -7 * i), to = addDays(from, 7);
    out.push({ from, secs: zoneTotals(activities.filter(a => a.startDate >= from && a.startDate < to), 'hr') });
  }
  return out;
}

// 80/20 split from HR zone seconds: low = Z1–Z2, mid = Z3, high = Z4–Z5 (percentages)
function intensitySplit(secs) {
  const total = secs.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const pct = x => Math.round(x / total * 100);
  return { low: pct(secs[0] + secs[1]), mid: pct(secs[2]), high: pct(secs[3] + secs[4]) };
}

// "≤135 bpm", "FC ≤ 140", "<150" → 135 / 140 / 150
function hrCapOf(text) { const m = String(text || '').match(/[≤<]\s*=?\s*(\d{2,3})/); return m ? +m[1] : null; }

// Planned sessions with a heart-rate cap, matched to an activity in the last `days` days: time above the cap
function easySessionCheck(plan, activities, now = new Date(), days = 28) {
  if (!plan) return [];
  const matches = matchPlanToActivities(plan), since = addDays(dayStart(now), -days), rows = [];
  for (const week of plan.weeks || []) for (const s of week.sessions || []) {
    const cap = hrCapOf(s.hrTarget), act = cap && matches.get(s.id);
    if (!act || act.startDate < since || act.startDate > now) continue;
    const hist = act.streamStats && act.streamStats.hist && act.streamStats.hist.hr;
    let pct = null;
    if (hist) {
      let total = 0, above = 0;
      for (const [bin, sec] of Object.entries(hist)) { total += sec; if (+bin + HR_BIN / 2 > cap) above += sec; }
      pct = total ? Math.round(above / total * 100) : null;
    }
    rows.push({ session: s, activity: act, cap, pct, avgHr: act.avgHr || null });
  }
  return rows.sort((a, b) => b.activity.startDate - a.activity.startDate);
}

// Aerobic efficiency of long easy sessions (≥ 40 min, average HR ≤ 90 % of LTHR):
// runs: metres-effort per minute per beat (climbing counted as 100 m per metre of D+); rides: watts per beat
function aerobicPoints(activities, kind = 'run', now = new Date(), weeks = 16) {
  const since = addDays(dayStart(now), -7 * weeks);
  return activities.filter(a => a.startDate >= since && a.startDate <= now && a.avgHr > 0 && a.duration >= 2400
      && (kind === 'run' ? isRunning(a.sport) && a.distance > 0 : isCyc(a.sport) && (a.np || a.avgPower) > 0)
      && a.avgHr <= 0.9 * (+thresholdsAt(a.startDate).lthr || 165))
    .map(a => ({
      activity: a, date: a.startDate,
      ef: kind === 'run' ? ((a.distance + 100 * (a.elevationGain || 0)) / (a.duration / 60)) / a.avgHr : (a.np || a.avgPower) / a.avgHr,
      decoupling: a.streamStats && a.streamStats.decoupling != null ? a.streamStats.decoupling : null,
    }))
    .sort((a, b) => a.date - b.date);
}

// Last 4 weeks vs the 4 before: efficiency change (%) and average drift
function aerobicTrend(points, now = new Date()) {
  const cut = addDays(dayStart(now), -28), cut2 = addDays(cut, -28);
  const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const recent = points.filter(p => p.date >= cut), before = points.filter(p => p.date >= cut2 && p.date < cut);
  const efNow = avg(recent.map(p => p.ef)), efBefore = avg(before.map(p => p.ef));
  return {
    efChange: efNow && efBefore ? (efNow / efBefore - 1) * 100 : null,
    drift: avg(recent.map(p => p.decoupling).filter(v => v != null)),
    count: recent.length,
  };
}

// New bests in the last `days` days: each activity with the durations where it set an all-time or 12-month best,
// plus the longest run / most climbing in a run
function recentBests(activities, now = new Date(), days = 28) {
  const since = addDays(dayStart(now), -days), year = addDays(dayStart(now), -365), byAct = new Map();
  const add = (a, rank, label) => { if (!byAct.has(a)) byAct.set(a, { activity: a, allTime: [], year: [] }); byAct.get(a)[rank].push(label); };
  const curves = [
    { key: 'mmPower', test: a => isCyc(a.sport), label: d => `${fmtMmDuration(d)} power`, min: 5 },
    { key: 'mmSpeed', test: a => isRunning(a.sport), label: d => `${fmtMmDuration(d)} pace`, min: 60 }, // short GPS speeds are noise
  ];
  for (const c of curves) {
    const src = activities.filter(c.test), all = bestCurve(src, c.key), yr = bestCurve(src.filter(a => a.startDate >= year), c.key);
    for (const a of src.filter(a => a.startDate >= since && a.startDate <= now)) {
      for (const [d, v] of Object.entries((a.streamStats && a.streamStats[c.key]) || {})) {
        if (+d < c.min) continue;
        if (v >= all[d]) add(a, 'allTime', c.label(d)); else if (v >= yr[d]) add(a, 'year', c.label(d));
      }
    }
  }
  const runs = activities.filter(a => isRunning(a.sport));
  for (const [field, label] of [['distance', 'longest run'], ['elevationGain', 'most climbing in a run']]) {
    const max = (xs) => xs.reduce((m, a) => Math.max(m, a[field] || 0), 0);
    const all = max(runs), yr = max(runs.filter(a => a.startDate >= year));
    for (const a of runs.filter(a => a.startDate >= since && a.startDate <= now && a[field] > 0)) {
      if (a[field] >= all) add(a, 'allTime', label); else if (a[field] >= yr) add(a, 'year', label);
    }
  }
  return [...byAct.values()].sort((a, b) => b.activity.startDate - a.activity.startDate);
}

// ── Rendering ──

function renderInsights(now = new Date()) {
  const panel = document.getElementById('tab-insights');
  if (!panel) return;
  const empty = !allActivities.length;
  document.getElementById('insightsEmpty').hidden = !empty;
  if (panel.querySelectorAll) panel.querySelectorAll('.ins-card').forEach(c => { c.hidden = empty; });
  if (empty) return;
  renderStatusCard(now);
  renderRaceCard(now);
  renderGuardCard(now);
  renderIntensityCard(now);
  renderThresholdCard(now);
  renderAerobicCard(now);
  renderBestsCard(now);
  renderBestEfforts();
}

function setInsightsWindow(days) { insightsWindow = +days || 28; renderIntensityCard(); }
function setAerobicKind(kind) { insightsAerobicKind = kind === 'bike' ? 'bike' : 'run'; renderAerobicCard(); }

const TONE_VAR = { ok: 'var(--color-ok)', partial: 'var(--color-partial)', missed: 'var(--color-missed)', ctl: 'var(--color-ctl)' };

function renderStatusCard(now = new Date()) {
  const el = document.getElementById('insStatusBody');
  if (!el) return;
  const st = trainingStatus(pmcResult, now);
  const facts = st.ctl != null ? [
    ['Fitness', st.ctl.toFixed(0)], ['This week', fmtSigned(st.ramp)], ['4 weeks', fmtSigned(st.change28)],
    ['Load vs usual', `${st.ratio.toFixed(1)}×`], ['Form', fmtSigned(st.tsb, 0)],
  ] : [];
  el.innerHTML = `<div class="ins-status"><span class="ins-status__label" style="color:${TONE_VAR[st.tone]}">${escapeHtml(st.label)}</span>
      <p class="ins-status__reason">${escapeHtml(st.reason)}</p></div>
    ${facts.length ? `<div class="ins-facts">${facts.map(([k, v]) => `<div><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('')}</div>` : ''}`;
}

// Progress bar towards a target
function meterHtml(label, value, target, fmt) {
  const pct = target > 0 ? Math.min(100, Math.round(value / target * 100)) : 0;
  const tone = pct >= 100 ? 'ok' : pct >= 70 ? 'ctl' : 'partial';
  return `<div class="ins-meter"><div class="ins-meter__top"><span>${escapeHtml(label)}</span><b>${escapeHtml(fmt(value))} <small>/ ${escapeHtml(fmt(target))}</small></b></div>
    <div class="ins-meter__bar"><i style="width:${pct}%;background:${TONE_VAR[tone]}"></i></div></div>`;
}

function renderRaceCard(now = new Date()) {
  const el = document.getElementById('insRaceBody'), title = document.getElementById('insRaceTitle');
  if (!el) return;
  const race = nextRace(dayStart(now));
  if (!race) { title.textContent = 'Race readiness'; el.innerHTML = `<p class="card-text">Add a race in Season › Forecast to see how ready you are for it.</p>`; return; }
  const days = Math.round((race.date - dayStart(now)) / 86400000);
  title.textContent = `${race.name} · ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}`;
  const d = raceDemands(race), proj = projectFitnessTo(race.date, now), weeks = runWeeks(allActivities, now, 6);
  const longest = weeks.slice(0, 4).reduce((m, w) => w.longest && (w.longest.distance || 0) > (m ? m.distance : 0) ? w.longest : m, null);
  const maxDplusWeek = Math.max(0, ...weeks.slice(0, 4).map(w => w.dplus));
  const parts = [];
  if (proj) {
    const z = typeof tsbZone === 'function' ? tsbZone(proj.tsb) : null;
    parts.push(`<div class="ins-facts"><div><span>Race-day fitness</span><b>${proj.ctl.toFixed(0)}</b></div><div><span>Race-day form</span><b${z ? ` style="color:${escapeHtml(z.color)}"` : ''}>${fmtSigned(proj.tsb, 0)}</b></div><div><span>Based on</span><b>${proj.fromPlan ? 'Season plan' : 'average load'}</b></div></div>`);
    if (proj.tsb < 5) parts.push(`<p class="card-text">Form on race day is usually best between +5 and +25: ease off a little more in the last 10 days.</p>`);
  }
  if (d.km) {
    parts.push(meterHtml(`Longest run, last 4 weeks (aim for ~70 % of ${d.km} km)`, longest ? longest.distance / 1000 : 0, d.km * 0.7, v => `${v.toFixed(1)} km`));
    if (d.dplus) parts.push(meterHtml(`Most climbing in a week, last 4 weeks (race: ${d.dplus} m)`, maxDplusWeek, d.dplus, v => `${Math.round(v)} m`));
    const est = estimateRaceTime(allActivities, d, now);
    if (est) parts.push(`<div class="ins-race-time"><span>Estimated time</span><b>${escapeHtml(fmtDuration(Math.round(est.seconds)))}</b>
      <small>From your best recent run (${escapeHtml(fmtShortDate(est.activity.startDate))}, ${(est.activity.distance / 1000).toFixed(1)} km, ${Math.round(est.activity.elevationGain || 0)} m D+), climbing counted as distance. Easy runs make it pessimistic.</small></div>`);
  } else {
    parts.push(`<p class="card-text">Put the distance and climbing in the race name (e.g. "Trail 30km D+600") to compare your long runs with the race.</p>`);
  }
  el.innerHTML = parts.join('');
}

function renderGuardCard(now = new Date()) {
  const el = document.getElementById('insGuardBody');
  if (!el) return;
  const g = runLoadGuard(allActivities, now);
  const tone = { high: 'missed', caution: 'partial', ok: 'ok', none: 'ctl' }[g.level];
  const label = { high: 'Big jump', caution: 'Rising fast', ok: 'Steady', none: '—' }[g.level];
  const ws = g.weeks.slice(0, 6).reverse();
  const maxKm = Math.max(1, ...ws.map(w => w.km)), maxD = Math.max(1, ...ws.map(w => w.dplus));
  const bars = ws.map((w, i) => `<div class="ins-week${i === ws.length - 1 ? ' is-current' : ''}">
      <div class="ins-week__bars"><i class="km" style="height:${Math.round(w.km / maxKm * 100)}%" title="${w.km.toFixed(1)} km"></i><i class="dplus" style="height:${Math.round(w.dplus / maxD * 100)}%" title="${Math.round(w.dplus)} m D+"></i></div>
      <span>${i === ws.length - 1 ? 'Last 7 d' : escapeHtml(fmtShortDate(w.from))}</span><small>${w.km.toFixed(0)} km<br>${Math.round(w.dplus)} m</small></div>`).join('');
  el.innerHTML = `<div class="ins-status"><span class="ins-status__label" style="color:${TONE_VAR[tone]}">${label}</span><p class="ins-status__reason">${escapeHtml(g.message)}</p></div>
    <div class="ins-weeks" role="img" aria-label="Running distance and climbing per 7 days">${bars}</div>
    <div class="ins-legend"><span><i class="km"></i>Distance</span><span><i class="dplus"></i>Climbing</span></div>`;
}

function renderIntensityCard(now = new Date()) {
  const el = document.getElementById('insIntensityBody');
  if (!el) return;
  const sel = document.getElementById('insWindow'); if (sel) sel.value = String(insightsWindow);
  const withStreams = allActivities.filter(a => a.streamStats && !a.streamStats.none);
  const since = new Date(now.getTime() - insightsWindow * 86400000);
  const recent = withStreams.filter(a => a.startDate >= since && a.startDate <= now);
  const hr = zoneTotals(recent, 'hr'), pw = zoneTotals(recent.filter(a => isCyc(a.sport)), 'power');
  const split = intensitySplit(hr);
  const easy = easySessionCheck(trainingPlan, allActivities, now, Math.max(28, insightsWindow));
  const zones = zoneBarHtml(`Heart rate zones · last ${insightsWindow} days`, HR_ZONES.names, hr) + zoneBarHtml(`Power zones (rides) · last ${insightsWindow} days`, POWER_ZONES.names, pw);
  const splitHtml = split ? `<div class="ins-facts"><div><span>Easy (Z1–Z2)</span><b style="color:${split.low >= 75 ? 'var(--color-ok)' : 'var(--color-partial)'}">${split.low} %</b></div><div><span>Moderate (Z3)</span><b>${split.mid} %</b></div><div><span>Hard (Z4–Z5)</span><b>${split.high} %</b></div></div>
    <p class="card-text">${split.low >= 75 ? 'Good: most of your time is easy, which builds the aerobic base with little fatigue.' : `Aim for about 80 % easy. Moderate "grey zone" time (${split.mid} %) tires you without the benefits of real intervals.`}</p>` : '';
  const easyHtml = easy.length ? `<h3 class="ins-subtitle">Easy sessions vs their heart-rate cap</h3><div class="ins-list">${easy.slice(0, 8).map(r => {
      const bad = r.pct != null ? r.pct > 20 : r.avgHr > r.cap;
      const val = r.pct != null ? `${r.pct} % above ${r.cap}` : `avg ${r.avgHr || '—'} / cap ${r.cap}`;
      return `<button class="btn-reset ins-list__row" data-id="${escapeHtml(r.activity.id || '')}" onclick="if (this.dataset.id) openActivityDetail(this.dataset.id)">
        <span class="ins-list__main"><b>${escapeHtml(calendarSessionName(r.session.name))}</b><small>${escapeHtml(fmtShortDate(r.activity.startDate))} · cap ${r.cap} bpm</small></span>
        <span class="ins-list__value" style="color:${bad ? 'var(--color-partial)' : 'var(--color-ok)'}">${escapeHtml(val)}</span></button>`;
    }).join('')}</div>` : '';
  el.innerHTML = (zones || `<p class="card-text">No heart-rate data in the last ${insightsWindow} days yet.</p>`) + splitHtml
    + `<div class="chart-canvas-wrap chart-canvas-wrap--short"><canvas id="insZonesCanvas" aria-label="Time in heart-rate zones per week"></canvas></div>` + easyHtml;
  // Weekly HR zones, last 12 weeks
  if (insZonesChart) { insZonesChart.destroy(); insZonesChart = null; }
  const canvas = document.getElementById('insZonesCanvas');
  if (!canvas || typeof Chart === 'undefined' || !canvas.getContext) return;
  const weeks = weeklyHrZones(withStreams, now, 12), c = C();
  insZonesChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: weeks.map(w => fmtShortDate(w.from)), datasets: HR_ZONES.names.map((name, i) => ({ label: name, data: weeks.map(w => +(w.secs[i] / 3600).toFixed(2)), backgroundColor: zoneColor(i), borderWidth: 0, stack: 'z', maxBarThickness: 28 })) },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...chartTooltip(), callbacks: { label: x => `${x.dataset.label}: ${fmtHours(Math.round(x.raw * 3600))}` } } },
      scales: { x: chartScaleX({ stacked: true, ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 12 } }), y: chartScaleY({ stacked: true, ticks: { color: c.muted, callback: v => `${v} h` } }) } },
  });
}

function renderThresholdCard(now = new Date()) {
  const el = document.getElementById('insightsBody');
  if (!el) return;
  const th = currentThresholds();
  const row = (title, est, current, unit, onUse, hint) => {
    if (!est) return `<div class="insight-row"><div class="insight-stat"><span class="insight-stat-label">${escapeHtml(title)}</span><span class="insight-muted">${escapeHtml(hint)}</span></div></div>`;
    const diff = current ? Math.round((est.value - current) / current * 100) : 0;
    return `<div class="insight-row"><div class="insight-stat"><span class="insight-stat-value">${est.value} ${unit}</span>
      <span class="insight-stat-label">${escapeHtml(title)} · current ${current} ${unit}${diff ? ` (${diff > 0 ? '+' : ''}${diff} %)` : ''}${est.source === 'summary' ? ' · rough, from average heart rates' : ''}</span></div>
      ${Math.abs(diff) >= 3 ? `<button class="btn btn--secondary btn--sm" onclick="${onUse}(${est.value})">Use ${est.value} ${unit} from today</button>` : ''}</div>`;
  };
  const eftp = estimateFtp(allActivities, now), elthr = estimateLthr(allActivities, now);
  const stravaTotal = allActivities.filter(a => typeof stravaIdOf === 'function' && stravaIdOf(a)).length;
  const pending = allActivities.filter(a => typeof stravaIdOf === 'function' && stravaIdOf(a) && needsStreamStats(a)).length;
  el.innerHTML = row('Estimated LTHR (runs, 90 days)', elthr, +th.lthr, 'bpm', 'useEstimatedLthr', 'Needs runs with heart rate in the last 90 days.')
    + `<p class="card-text">Runs are scored with your LTHR, so keep it up to date. The estimate is only right if you ran at least one hard, sustained effort (race, tempo) in the last 90 days.</p>`
    + row('Estimated FTP (rides, 90 days)', eftp ? { value: eftp } : null, +th.ftp, 'W', 'useEstimatedFtp', 'Needs rides with a power meter in the last 90 days.')
    + (stravaTotal ? `<div class="insight-muted">Detailed data for ${stravaTotal - pending} of ${stravaTotal} Strava activities${pending ? ' — the rest is fetched in the background (Strava allows ~100 requests / 15 min)' : ''}.</div>` : '');
}

// Record an estimated threshold as a new threshold entry starting today
async function useEstimatedThreshold(field, value, text) {
  const t = currentThresholds();
  if (!confirm(text)) return;
  fillThresholdInputs({ ...t, [field]: value });
  document.getElementById('inputThresholdFrom').value = localDateKey(new Date());
  await saveThresholdsFromInputs();
  renderInsights();
}
function useEstimatedFtp(v) { return useEstimatedThreshold('ftp', v, `Set FTP to ${v} W from today? Rides from today on will be scored with it.`); }
function useEstimatedLthr(v) { return useEstimatedThreshold('lthr', v, `Set LTHR to ${v} bpm from today? Runs and heart-rate zones from today on will use it.`); }

function renderAerobicCard(now = new Date()) {
  const el = document.getElementById('insAerobicBody');
  if (!el) return;
  const sel = document.getElementById('insAerobicKind'); if (sel) sel.value = insightsAerobicKind;
  const kind = insightsAerobicKind, pts = aerobicPoints(allActivities, kind, now), t = aerobicTrend(pts, now);
  if (insAerobicChart) { insAerobicChart.destroy(); insAerobicChart = null; }
  if (pts.length < 3) { el.innerHTML = `<p class="card-text">Needs a few long easy ${kind === 'run' ? 'runs' : 'rides'} (40 min or more, heart rate under 90 % of LTHR) with heart rate${kind === 'bike' ? ' and power' : ''}.</p>`; return; }
  const efText = t.efChange == null ? '—' : `${fmtSigned(t.efChange)} %`;
  el.innerHTML = `<div class="ins-facts"><div><span>Efficiency, last 4 weeks</span><b style="color:${t.efChange == null ? 'inherit' : t.efChange >= 0 ? 'var(--color-ok)' : 'var(--color-partial)'}">${efText}</b></div>
      <div><span>Heart-rate drift</span><b style="color:${t.drift == null ? 'inherit' : t.drift <= 5 ? 'var(--color-ok)' : 'var(--color-partial)'}">${t.drift == null ? '—' : `${t.drift.toFixed(1)} %`}</b></div><div><span>Sessions</span><b>${t.count}</b></div></div>
    <p class="card-text">Efficiency = ${kind === 'run' ? 'distance (climbing counted as distance)' : 'power'} per heartbeat on easy sessions: going up means more speed for the same effort. Drift under 5 % on long sessions shows a solid aerobic base.</p>
    <div class="chart-canvas-wrap chart-canvas-wrap--short"><canvas id="insAerobicCanvas" aria-label="Aerobic efficiency over time"></canvas></div>`;
  const canvas = document.getElementById('insAerobicCanvas');
  if (!canvas || typeof Chart === 'undefined' || !canvas.getContext) return;
  const c = C(), labels = pts.map(p => localDateKey(p.date));
  const rolling = pts.map((p, i) => { const w = pts.filter(q => q.date <= p.date && q.date > addDays(p.date, -28)); return +(w.reduce((s, q) => s + q.ef, 0) / w.length).toFixed(3); });
  insAerobicChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Session', data: pts.map(p => +p.ef.toFixed(3)), showLine: false, pointRadius: 3.5, pointBackgroundColor: withAlpha(c.ctl, 0.45), borderColor: 'transparent' },
      { label: '4-week average', data: rolling, borderColor: c.ctl, borderWidth: 2.5, pointRadius: 0, tension: 0.3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...chartTooltip(), callbacks: { title: x => { const p = pts[x[0].dataIndex]; return `${fmtShortDate(p.date)} · ${p.activity.name || fmtSportName(p.activity.sport)}`; }, label: x => `${x.dataset.label}: ${x.raw}` } } },
      scales: { x: chartScaleX({ ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 16, callback: function (v) { return fmtShortDate(parseIsoDate(this.getLabelForValue(v))); } } }), y: chartScaleY({ ticks: { color: c.muted } }) } },
  });
}

function renderBestsCard(now = new Date()) {
  const el = document.getElementById('insBestsBody');
  if (!el) return;
  const rows = recentBests(allActivities, now);
  el.innerHTML = rows.length ? `<div class="ins-list">${rows.slice(0, 8).map(r => {
      const a = r.activity;
      return `<button class="btn-reset ins-list__row" data-id="${escapeHtml(a.id || '')}" onclick="if (this.dataset.id) openActivityDetail(this.dataset.id)">
        ${sportDot(a.sport)}<span class="ins-list__main"><b>${escapeHtml(a.name || fmtSportName(a.sport))}</b><small>${escapeHtml(fmtShortDate(a.startDate))}</small>
        ${r.allTime.length ? `<span class="ins-best ins-best--all">All-time best: ${escapeHtml(r.allTime.join(', '))}</span>` : ''}
        ${r.year.length ? `<span class="ins-best">Best in 12 months: ${escapeHtml(r.year.join(', '))}</span>` : ''}</span></button>`;
    }).join('')}</div>` : `<p class="card-text">No new bests in the last 28 days.</p>`;
}

// Best power (rides) and pace (runs) curves for a period vs all-time
function renderBestEfforts() {
  const wrap = document.getElementById('bestEffortsCard');
  if (!wrap) return;
  const sel = document.getElementById('bestEffortsRange');
  const kind = document.getElementById('bestEffortsKind')?.value || 'power';
  const days = +(sel?.value || 90);
  const src = allActivities.filter(a => a.streamStats && (kind === 'power' ? isCyc(a.sport) : isRun(a.sport)));
  const key = kind === 'power' ? 'mmPower' : 'mmSpeed';
  const allTime = bestCurve(src, key);
  const period = bestCurve(src.filter(a => a.startDate >= new Date(Date.now() - days * 86400000)), key);
  const durations = MM_DURATIONS.filter(d => allTime[d] != null);
  const empty = document.getElementById('bestEffortsEmpty');
  if (bestEffortsChart) { bestEffortsChart.destroy(); bestEffortsChart = null; }
  if (!durations.length) { if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  const toVal = v => v == null ? null : kind === 'power' ? Math.round(v) : +(1000 / v / 60).toFixed(2); // W, or min/km
  const fmt = v => kind === 'power' ? `${v} W` : fmtPaceFromSpeed(1000 / (v * 60));
  const canvas = document.getElementById('bestEffortsCanvas');
  if (!canvas || typeof Chart === 'undefined') return;
  const c = C();
  bestEffortsChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: durations.map(fmtMmDuration),
      datasets: [
        { label: `Last ${days} days`, data: durations.map(d => toVal(period[d])), borderColor: c.ctl, backgroundColor: withAlpha(c.ctl, 0.08), fill: true, borderWidth: 2.5, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, spanGaps: true },
        { label: 'All-time', data: durations.map(d => toVal(allTime[d])), borderColor: withAlpha(c.dim, 0.7), borderDash: [4, 4], borderWidth: 1.5, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { align: 'start', labels: { color: c.dim, usePointStyle: true, pointStyle: 'line' } }, tooltip: { ...chartTooltip(), callbacks: { label: x => `${x.dataset.label}: ${x.raw == null ? '—' : fmt(x.raw)}` } } },
      scales: {
        x: chartScaleX(),
        y: chartScaleY({ reverse: kind !== 'power', ticks: { color: c.muted, padding: 8, callback: v => kind === 'power' ? `${v} W` : fmtPaceFromSpeed(1000 / (v * 60)).replace('/km', '') } }),
      },
    },
  });
}
