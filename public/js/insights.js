// ══════════════════════════════════════════════
// Insights from detailed (stream) data
// ══════════════════════════════════════════════
// Overview "Training insights": estimated FTP, time in zones (last 28 days), data coverage.
// Compare tab "Best efforts": power / pace curves for a period vs all-time.

let bestEffortsChart = null;
const ZONE_COLORS = ['#64748b', '#3b82f6', '#10b981', '#f59e0b', '#f97316', '#f43f5e', '#a855f7'];

function fmtHours(sec) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`; }
function fmtMmDuration(d) { d = +d; return d < 60 ? `${d}s` : d < 3600 ? `${d / 60}min` : `${d / 3600}h`; }
function fmtPaceFromSpeed(mps) { if (!(mps > 0)) return '—'; const s = Math.round(1000 / mps); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/km`; }

// Horizontal stacked bar + legend for seconds per zone
function zoneBarHtml(title, names, secs) {
  const total = secs.reduce((a, b) => a + b, 0);
  if (!total) return '';
  const segs = secs.map((s, i) => s ? `<span style="width:${(s / total * 100).toFixed(2)}%;background:${ZONE_COLORS[i]}" title="${escapeHtml(names[i])}: ${fmtHours(s)}"></span>` : '').join('');
  const legend = secs.map((s, i) => `<span class="zone-legend-item"><i style="background:${ZONE_COLORS[i]}"></i>${escapeHtml(names[i].split(' ')[0])} ${fmtHours(s)} <small>${Math.round(s / total * 100)}%</small></span>`).join('');
  return `<div class="zone-block"><div class="zone-block-title">${escapeHtml(title)} <small>${fmtHours(total)}</small></div><div class="zone-bar" role="img" aria-label="${escapeHtml(title)}">${segs}</div><div class="zone-legend">${legend}</div></div>`;
}

function renderInsights(now = new Date()) {
  const card = document.getElementById('insightsCard');
  if (!card) return;
  const withStreams = allActivities.filter(a => a.streamStats && !a.streamStats.none);
  const stravaTotal = allActivities.filter(a => typeof stravaIdOf === 'function' && stravaIdOf(a)).length;
  const fetched = allActivities.filter(a => a.streamStats).length;
  if (!allActivities.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  const since = new Date(now.getTime() - 28 * 86400000);
  const recent = withStreams.filter(a => a.startDate >= since);
  const hr = zoneTotals(recent, 'hr');
  const pw = zoneTotals(recent.filter(a => isCyc(a.sport)), 'power');

  const eftp = estimateFtp(allActivities, now);
  const ftpNow = +currentThresholds().ftp;
  let eftpHtml = '<div class="insight-muted">Estimated FTP needs rides with a power meter in the last 90 days.</div>';
  if (eftp) {
    const diff = ftpNow ? Math.round((eftp - ftpNow) / ftpNow * 100) : 0;
    eftpHtml = `<div class="insight-stat"><span class="insight-stat-value">${eftp} W</span><span class="insight-stat-label">estimated FTP (90 days) · current ${ftpNow} W${diff ? ` (${diff > 0 ? '+' : ''}${diff}%)` : ''}</span></div>`
      + (Math.abs(diff) >= 3 ? `<button class="btn-base btn-ghost" style="padding:6px 12px;font-size:13px" onclick="useEstimatedFtp(${eftp})">Use ${eftp} W from today</button>` : '');
  }
  const coverage = stravaTotal
    ? `<div class="insight-muted">Detailed data for ${fetched} of ${stravaTotal} Strava activities${fetched < stravaTotal ? ' — the rest is fetched in the background (Strava allows ~100 requests / 15 min)' : ''}.</div>`
    : '';
  const zones = zoneBarHtml('Heart rate zones · last 28 days', HR_ZONES.names, hr) + zoneBarHtml('Power zones (rides) · last 28 days', POWER_ZONES.names, pw);
  document.getElementById('insightsBody').innerHTML =
    `<div class="insight-row">${eftpHtml}</div>${zones || '<div class="insight-muted">No heart-rate or power data in the last 28 days yet.</div>'}${coverage}`;
  renderBestEfforts();
}

// Record the estimated FTP as a new threshold entry starting today
async function useEstimatedFtp(eftp) {
  const t = currentThresholds();
  if (!confirm(`Set FTP to ${eftp} W from today? Rides from today on will be scored with it.`)) return;
  fillThresholdInputs({ ...t, ftp: eftp });
  document.getElementById('inputThresholdFrom').value = localDateKey(new Date());
  await saveThresholdsFromInputs();
  renderInsights();
}

// Compare tab: best power (rides) and pace (runs) curves for a period vs all-time
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
  bestEffortsChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: durations.map(fmtMmDuration),
      datasets: [
        { label: `Last ${days} days`, data: durations.map(d => toVal(period[d])), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)', fill: true, tension: 0.3, pointRadius: 3, spanGaps: true },
        { label: 'All-time', data: durations.map(d => toVal(allTime[d])), borderColor: 'rgba(163,168,188,0.8)', borderDash: [6, 4], tension: 0.3, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#a3a8bc' } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? '—' : fmt(c.raw)}` } } },
      scales: {
        x: { grid: { color: 'rgba(42,45,62,0.4)' }, ticks: { color: '#858aa3' } },
        y: { reverse: kind !== 'power', grid: { color: 'rgba(42,45,62,0.3)' }, ticks: { color: '#858aa3', callback: v => kind === 'power' ? `${v} W` : fmtPaceFromSpeed(1000 / (v * 60)).replace('/km', '') },
             title: { display: true, text: kind === 'power' ? 'Best average power' : 'Best pace (min/km)', color: '#858aa3' } },
      },
    },
  });
}
