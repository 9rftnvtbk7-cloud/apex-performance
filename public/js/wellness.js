// ══════════════════════════════════════════════
// Wellness log & readiness
// ══════════════════════════════════════════════
// One entry per day in users/{uid}/wellness/{YYYY-MM-DD}:
//   { date, restingHr, hrv, sleepHours, sleepQuality 1–5, weight, soreness 1–5, stress 1–5, notes }
// Readiness is a transparent rule set (no black box): form (TSB), resting HR and HRV vs the 7-day
// baseline, sleep, soreness and stress. Every flag is listed with its reason.

let wellnessEntries = {}; // date → entry
const WELLNESS_FIELDS = [
  { key: 'restingHr', label: 'Resting HR', unit: 'bpm', type: 'number', min: 25, max: 120 },
  { key: 'hrv', label: 'HRV', unit: 'ms', type: 'number', min: 5, max: 300 },
  { key: 'sleepHours', label: 'Sleep', unit: 'h', type: 'number', min: 0, max: 16, step: 0.25 },
  { key: 'sleepQuality', label: 'Sleep quality', unit: '/5', type: 'scale' },
  { key: 'soreness', label: 'Soreness', unit: '/5', type: 'scale' },
  { key: 'stress', label: 'Stress', unit: '/5', type: 'scale' },
  { key: 'weight', label: 'Weight', unit: 'kg', type: 'number', min: 25, max: 250, step: 0.1 },
];

// Keep only valid, in-range values; drop empty fields
function cleanWellness(raw) {
  const out = {};
  for (const f of WELLNESS_FIELDS) {
    const v = raw[f.key];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (f.type === 'scale') { if (n >= 1 && n <= 5) out[f.key] = Math.round(n); }
    else if (n >= f.min && n <= f.max) out[f.key] = Math.round(n * 100) / 100;
  }
  if (raw.notes && String(raw.notes).trim()) out.notes = String(raw.notes).trim().slice(0, 2000);
  return out;
}

// Average of a field over the 7 days before `dateKey` (the baseline), or null with < 3 values
function wellnessBaseline(key, dateKey, entries = wellnessEntries) {
  const d = parseIsoDate(dateKey);
  const vals = [];
  for (let i = 1; i <= 7; i++) { const e = entries[localDateKey(addDays(d, -i))]; if (e && e[key] != null) vals.push(e[key]); }
  return vals.length >= 3 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// → { level: 'ready' | 'caution' | 'rest', label, color, reasons: [{ text, level }] }
function computeReadiness(dateKey, tsb, entries = wellnessEntries) {
  const reasons = [];
  const e = entries[dateKey] || {};
  if (tsb != null) {
    if (tsb < -30) reasons.push({ level: 'rest', text: `Form ${tsb.toFixed(0)}: very high fatigue` });
    else if (tsb < -20) reasons.push({ level: 'caution', text: `Form ${tsb.toFixed(0)}: carrying a lot of fatigue` });
    else if (tsb > 5) reasons.push({ level: 'ready', text: `Form +${tsb.toFixed(0)}: fresh` });
  }
  const rhrBase = wellnessBaseline('restingHr', dateKey, entries);
  if (e.restingHr != null && rhrBase != null) {
    const d = e.restingHr - rhrBase;
    if (d >= 7) reasons.push({ level: 'rest', text: `Resting HR ${e.restingHr} bpm, +${d.toFixed(0)} vs 7-day average` });
    else if (d >= 4) reasons.push({ level: 'caution', text: `Resting HR ${e.restingHr} bpm, +${d.toFixed(0)} vs 7-day average` });
  }
  const hrvBase = wellnessBaseline('hrv', dateKey, entries);
  if (e.hrv != null && hrvBase != null) {
    const pct = (e.hrv - hrvBase) / hrvBase * 100;
    if (pct <= -20) reasons.push({ level: 'rest', text: `HRV ${e.hrv} ms, ${pct.toFixed(0)}% vs 7-day average` });
    else if (pct <= -10) reasons.push({ level: 'caution', text: `HRV ${e.hrv} ms, ${pct.toFixed(0)}% vs 7-day average` });
  }
  if (e.sleepHours != null && e.sleepHours < 5) reasons.push({ level: 'rest', text: `Only ${e.sleepHours} h of sleep` });
  else if (e.sleepHours != null && e.sleepHours < 6.5) reasons.push({ level: 'caution', text: `Short sleep (${e.sleepHours} h)` });
  if (e.sleepQuality != null && e.sleepQuality <= 2) reasons.push({ level: 'caution', text: `Poor sleep quality (${e.sleepQuality}/5)` });
  if (e.soreness != null && e.soreness >= 4) reasons.push({ level: e.soreness === 5 ? 'rest' : 'caution', text: `Soreness ${e.soreness}/5` });
  if (e.stress != null && e.stress >= 4) reasons.push({ level: 'caution', text: `Stress ${e.stress}/5` });

  // Form in the normal range: shown as context, doesn't change the verdict
  if (tsb != null && tsb >= -20 && tsb <= 5) reasons.push({ level: 'info', text: `Form ${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}: ${tsbZone(tsb).label.toLowerCase()}` });

  const rest = reasons.filter(r => r.level === 'rest').length, caution = reasons.filter(r => r.level === 'caution').length;
  if (rest || caution >= 3) return { level: 'rest', label: 'Rest or go very easy', color: 'var(--color-red)', reasons };
  if (caution) return { level: 'caution', label: 'Train, but with care', color: 'var(--color-amber)', reasons };
  return { level: 'ready', label: 'Ready to train', color: 'var(--color-green)', reasons };
}

function renderReadiness(now = new Date()) {
  const card = document.getElementById('readinessCard');
  if (!card) return;
  const key = localDateKey(now);
  const tsb = pmcResult && pmcResult.lastCtl != null ? pmcResult.lastCtl - pmcResult.lastAtl : null;
  const r = computeReadiness(key, tsb);
  const e = wellnessEntries[key];
  const reasons = r.reasons.length
    ? `<ul class="readiness-reasons">${r.reasons.map(x => `<li class="is-${x.level}">${escapeHtml(x.text)}</li>`).join('')}</ul>`
    : `<div class="insight-muted">${e ? 'Nothing unusual today.' : 'Log this morning’s resting HR, HRV and sleep for a better readiness check.'}</div>`;
  document.getElementById('readinessBody').innerHTML = `
    <div class="readiness-head"><span class="readiness-dot" style="background:${r.color}"></span><span class="readiness-label" style="color:${r.color}">${escapeHtml(r.label)}</span></div>
    ${reasons}
    <details class="wellness-form-wrap"${e ? '' : ' open'}><summary>${e ? 'Edit today’s wellness' : 'Log today’s wellness'}</summary>${wellnessFormHtml(key, e || {})}</details>
    ${wellnessHistoryHtml(now)}`;
  card.style.display = 'block';
}

function wellnessFormHtml(dateKey, e) {
  const input = f => f.type === 'scale'
    ? `<select class="compare-select" id="well_${f.key}" aria-label="${f.label}"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${e[f.key] === n ? ' selected' : ''}>${n}</option>`).join('')}</select>`
    : `<input class="settings-input" type="number" inputmode="decimal" id="well_${f.key}" aria-label="${f.label}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${e[f.key] ?? ''}">`;
  return `<form class="wellness-form" onsubmit="event.preventDefault(); saveWellnessFromForm('${dateKey}')">
    <div class="wellness-grid">${WELLNESS_FIELDS.map(f => `<label class="wellness-field"><span class="settings-label">${f.label} <small>${f.unit}</small></span>${input(f)}</label>`).join('')}</div>
    <label class="wellness-field"><span class="settings-label">Notes</span><input class="settings-input" id="well_notes" value="${escapeHtml(e.notes || '')}" maxlength="2000" placeholder="Illness, travel, niggles…"></label>
    <button class="btn-base btn-upload" type="submit" style="margin-top:10px">Save</button>
  </form>`;
}

function wellnessHistoryHtml(now) {
  const days = Array.from({ length: 7 }, (_, i) => localDateKey(addDays(now, -i)));
  if (!days.some(d => wellnessEntries[d])) return '';
  const cell = (d, k) => { const v = wellnessEntries[d]?.[k]; return v == null ? '—' : escapeHtml(v); };
  const rows = days.map(d => `<tr><td>${escapeHtml(parseIsoDate(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }))}</td><td>${cell(d, 'restingHr')}</td><td>${cell(d, 'hrv')}</td><td>${cell(d, 'sleepHours')}</td><td>${cell(d, 'soreness')}</td><td>${cell(d, 'weight')}</td></tr>`).join('');
  return `<details class="wellness-history"><summary>Last 7 days</summary><div class="plan-steps-wrap"><table class="plan-steps"><thead><tr><th>Day</th><th>RHR</th><th>HRV</th><th>Sleep</th><th>Sore</th><th>Kg</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

async function saveWellnessFromForm(dateKey) {
  const raw = {};
  for (const f of WELLNESS_FIELDS) raw[f.key] = document.getElementById(`well_${f.key}`)?.value;
  raw.notes = document.getElementById('well_notes')?.value;
  const entry = cleanWellness(raw);
  wellnessEntries[dateKey] = { date: dateKey, ...entry };
  const ok = typeof saveWellnessEntry === 'function' ? await saveWellnessEntry(dateKey, wellnessEntries[dateKey]) : false;
  showToast(ok ? 'Wellness saved' : 'Could not save wellness', ok ? '✅' : '❌');
  renderReadiness();
}
