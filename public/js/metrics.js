// ══════════════════════════════════════════════
// Stream metrics (Strava second-by-second data)
// ══════════════════════════════════════════════
// Pure functions turning Strava streams into compact per-activity stats, stored on the activity as
// `streamStats` (small enough for Firestore, independent of thresholds):
//   hist.hr / hist.pw : { bin: seconds } histograms (HR in 2-bpm bins, power in 10-W bins), so time in
//                       zones can be recomputed for any threshold without refetching the streams
//   mmPower / mmSpeed : best average power (W) / speed (m/s) for each duration in MM_DURATIONS
//   decoupling        : aerobic decoupling % (output per heartbeat, first half vs second half)

const STREAM_STATS_VERSION = 1;
const MM_DURATIONS = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
const HR_BIN = 2, PW_BIN = 10;
// Zone upper bounds as a fraction of the threshold (last zone is open-ended)
const HR_ZONES = { names: ['Z1 Recovery', 'Z2 Aerobic', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO2'], bounds: [0.81, 0.90, 0.94, 1.00] };
const POWER_ZONES = { names: ['Z1 Recovery', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Threshold', 'Z5 VO2max', 'Z6 Anaerobic', 'Z7 Neuromuscular'], bounds: [0.55, 0.75, 0.90, 1.05, 1.20, 1.50] };

// Resample (time, value) to one value per second; gaps up to `maxGap` s are filled with the last value,
// longer gaps (pauses) are skipped so they don't count as effort.
function resample1Hz(time, values, maxGap = 10) {
  const out = [];
  if (!time || !values || !time.length) return out;
  for (let i = 0; i < time.length; i++) {
    const v = values[i];
    if (v == null) continue;
    const dt = i + 1 < time.length ? time[i + 1] - time[i] : 1;
    const n = dt > 0 && dt <= maxGap ? dt : 1;
    for (let k = 0; k < n; k++) out.push(v);
  }
  return out;
}

// Best rolling average for each duration (seconds) over a 1 Hz series
function meanMax(series, durations = MM_DURATIONS) {
  const res = {};
  if (!series.length) return res;
  const prefix = new Float64Array(series.length + 1);
  for (let i = 0; i < series.length; i++) prefix[i + 1] = prefix[i] + series[i];
  for (const d of durations) {
    if (d > series.length) break;
    let best = -Infinity;
    for (let i = d; i <= series.length; i++) { const avg = (prefix[i] - prefix[i - d]) / d; if (avg > best) best = avg; }
    res[d] = Math.round(best * 100) / 100;
  }
  return res;
}

// Seconds per bin: { "140": 312, ... } (bin = floor(value / size) * size)
function histogram(series1Hz, size) {
  const h = {};
  for (const v of series1Hz) { if (!(v > 0)) continue; const b = Math.floor(v / size) * size; h[b] = (h[b] || 0) + 1; }
  return h;
}

// Seconds in each zone for a histogram and a threshold
function zonesFromHist(hist, threshold, zones) {
  const secs = new Array(zones.names.length).fill(0);
  if (!hist || !(threshold > 0)) return secs;
  for (const [bin, s] of Object.entries(hist)) {
    const frac = (+bin + (zones === HR_ZONES ? HR_BIN : PW_BIN) / 2) / threshold;
    let z = zones.bounds.findIndex(b => frac < b);
    if (z < 0) z = zones.names.length - 1;
    secs[z] += s;
  }
  return secs;
}

// Aerobic decoupling: % drop of (output / HR) from first to second half. Needs ≥ 30 min with HR.
function decouplingPct(output1Hz, hr1Hz) {
  const n = Math.min(output1Hz.length, hr1Hz.length);
  if (n < 1800) return null;
  const half = Math.floor(n / 2);
  const ratio = (a, b) => {
    let o = 0, h = 0;
    for (let i = a; i < b; i++) { o += output1Hz[i] || 0; h += hr1Hz[i] || 0; }
    return h > 0 ? o / h : null;
  };
  const r1 = ratio(0, half), r2 = ratio(half, n);
  if (!r1 || !r2) return null;
  return Math.round((r1 - r2) / r1 * 1000) / 10;
}

// Strava streams ({ time: {data}, heartrate: {data}, watts: {data}, velocity_smooth: {data} }) → streamStats
function computeStreamStats(streams, sport) {
  const data = k => streams && streams[k] && Array.isArray(streams[k].data) ? streams[k].data : null;
  const time = data('time');
  if (!time) return { v: STREAM_STATS_VERSION, none: true };
  const hr = resample1Hz(time, data('heartrate'));
  const pw = resample1Hz(time, data('watts'));
  const sp = resample1Hz(time, data('velocity_smooth'));
  const stats = { v: STREAM_STATS_VERSION, hist: {} };
  if (hr.length) stats.hist.hr = histogram(hr, HR_BIN);
  if (pw.length) { stats.hist.pw = histogram(pw, PW_BIN); stats.mmPower = meanMax(pw); }
  if (sp.length && !isCyc(sport)) stats.mmSpeed = meanMax(sp);
  // Decoupling on power for rides (if a power meter was used), on speed otherwise
  const output = isCyc(sport) ? pw : sp;
  if (hr.length && output.length) {
    const d = decouplingPct(output, hr);
    if (d !== null) stats.decoupling = d;
  }
  return stats;
}

// Best mean-max values over activities (optionally filtered), e.g. best 20-min power in 90 days
function bestCurve(activities, key) {
  const best = {};
  for (const a of activities) {
    const mm = a.streamStats && a.streamStats[key];
    if (!mm) continue;
    for (const [d, v] of Object.entries(mm)) if (!(best[d] >= v)) best[d] = v;
  }
  return best;
}

// Estimated FTP from the last `days` days: max(95% of best 20 min, best 60 min)
function estimateFtp(activities, now = new Date(), days = 90) {
  const since = new Date(now.getTime() - days * 86400000);
  const recent = activities.filter(a => isCyc(a.sport) && a.startDate >= since);
  const c = bestCurve(recent, 'mmPower');
  const e = Math.max((c[1200] || 0) * 0.95, c[3600] || 0);
  return e > 0 ? Math.round(e) : null;
}

// Seconds per zone summed over activities, each scored with the thresholds valid on its date
function zoneTotals(activities, kind) {
  const zones = kind === 'hr' ? HR_ZONES : POWER_ZONES;
  const total = new Array(zones.names.length).fill(0);
  for (const a of activities) {
    const hist = a.streamStats && a.streamStats.hist && a.streamStats.hist[kind === 'hr' ? 'hr' : 'pw'];
    if (!hist) continue;
    const th = thresholdsAt(a.startDate);
    const secs = zonesFromHist(hist, kind === 'hr' ? +th.lthr : +th.ftp, zones);
    secs.forEach((s, i) => { total[i] += s; });
  }
  return total;
}
