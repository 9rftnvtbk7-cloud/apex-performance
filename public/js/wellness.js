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
    if (tsb < -30) reasons.push({ key: 'tsb', level: 'rest', text: `Form ${tsb.toFixed(0)}: very high fatigue` });
    else if (tsb < -20) reasons.push({ key: 'tsb', level: 'caution', text: `Form ${tsb.toFixed(0)}: carrying a lot of fatigue` });
    else if (tsb > 5) reasons.push({ key: 'tsb', level: 'ready', text: `Form +${tsb.toFixed(0)}: fresh` });
  }
  const rhrBase = wellnessBaseline('restingHr', dateKey, entries);
  if (e.restingHr != null && rhrBase != null) {
    const d = e.restingHr - rhrBase;
    if (d >= 7) reasons.push({ key: 'restingHr', level: 'rest', text: `Resting HR ${e.restingHr} bpm, +${d.toFixed(0)} vs 7-day average` });
    else if (d >= 4) reasons.push({ key: 'restingHr', level: 'caution', text: `Resting HR ${e.restingHr} bpm, +${d.toFixed(0)} vs 7-day average` });
  }
  const hrvBase = wellnessBaseline('hrv', dateKey, entries);
  if (e.hrv != null && hrvBase != null) {
    const pct = (e.hrv - hrvBase) / hrvBase * 100;
    if (pct <= -20) reasons.push({ key: 'hrv', level: 'rest', text: `HRV ${e.hrv} ms, ${pct.toFixed(0)}% vs 7-day average` });
    else if (pct <= -10) reasons.push({ key: 'hrv', level: 'caution', text: `HRV ${e.hrv} ms, ${pct.toFixed(0)}% vs 7-day average` });
  }
  if (e.sleepHours != null && e.sleepHours < 5) reasons.push({ key: 'sleepHours', level: 'rest', text: `Only ${e.sleepHours} h of sleep` });
  else if (e.sleepHours != null && e.sleepHours < 6.5) reasons.push({ key: 'sleepHours', level: 'caution', text: `Short sleep (${e.sleepHours} h)` });
  if (e.sleepQuality != null && e.sleepQuality <= 2) reasons.push({ key: 'sleepQuality', level: 'caution', text: `Poor sleep quality (${e.sleepQuality}/5)` });
  if (e.soreness != null && e.soreness >= 4) reasons.push({ key: 'soreness', level: e.soreness === 5 ? 'rest' : 'caution', text: `Soreness ${e.soreness}/5` });
  if (e.stress != null && e.stress >= 4) reasons.push({ key: 'stress', level: 'caution', text: `Stress ${e.stress}/5` });

  // Form in the normal range: shown as context, doesn't change the verdict
  if (tsb != null && tsb >= -20 && tsb <= 5) reasons.push({ key: 'tsb', level: 'info', text: `Form ${tsb > 0 ? '+' : ''}${tsb.toFixed(0)}: ${tsbZone(tsb).label.toLowerCase()}` });

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
  const levelOf = k => (r.reasons.find(x => x.key === k) || {}).level;
  const cls = lvl => lvl === 'rest' ? 'is-rest' : lvl === 'caution' ? 'is-caution' : lvl === 'ready' ? 'is-ok' : '';
  const signed = (n, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
  const cell = (label, value, delta, lvl) => `<div class="stat"><div class="stat__label">${label}</div><div class="stat__value">${value}${delta ? `<span class="stat__delta ${cls(lvl)}">${delta}</span>` : ''}</div></div>`;

  let body;
  if (e) {
    const rhrBase = wellnessBaseline('restingHr', key), hrvBase = wellnessBaseline('hrv', key);
    const zone = tsb != null ? tsbZone(tsb).label.split('—')[0].trim().toLowerCase() : '';
    body = `<div class="stat-grid">
      ${cell('Form', tsb != null ? signed(tsb, 1) : '—', zone, tsb != null && tsb > 5 ? 'ready' : levelOf('tsb'))}
      ${cell('Resting HR', e.restingHr != null ? `${escapeHtml(e.restingHr)} bpm` : '—', e.restingHr != null && rhrBase != null ? signed(e.restingHr - rhrBase) : '', levelOf('restingHr'))}
      ${cell('HRV', e.hrv != null ? `${escapeHtml(e.hrv)} ms` : '—', e.hrv != null && hrvBase ? `${signed((e.hrv - hrvBase) / hrvBase * 100)} %` : '', levelOf('hrv'))}
      ${cell('Sleep', e.sleepHours != null ? `${escapeHtml(e.sleepHours)} h` : '—', '', levelOf('sleepHours'))}
    </div>`;
    // Reasons not shown in the grid (sleep quality, soreness, stress)
    const extra = r.reasons.filter(x => ['sleepQuality', 'soreness', 'stress'].includes(x.key));
    if (extra.length) body += `<ul class="readiness-reasons">${extra.map(x => `<li class="is-${x.level}">${escapeHtml(x.text)}</li>`).join('')}</ul>`;
  } else {
    const formLine = r.reasons.find(x => x.key === 'tsb');
    body = `${formLine ? `<ul class="readiness-reasons"><li class="is-${formLine.level}">${escapeHtml(formLine.text)}</li></ul>` : ''}
      <p class="readiness__empty">Log resting HR, HRV and sleep for a complete check.</p>
      <button class="btn btn--primary btn--block" onclick="toggleWellnessPanel('form', true)">Log how you feel</button>`;
  }
  const icon = { ready: '✓', caution: '!', rest: '✕' }[r.level];
  document.getElementById('readinessBody').innerHTML = `
    <div class="readiness readiness--${r.level}">
      <div class="readiness__icon" aria-hidden="true">${icon}</div>
      <div><div class="readiness__label">Readiness</div><div class="readiness__verdict">${escapeHtml(r.label)}</div></div>
    </div>
    ${body}
    <div class="readiness__links">
      <button class="btn-reset" aria-expanded="false" aria-controls="wellnessPanelForm" onclick="toggleWellnessPanel('form')">${e ? 'Edit <span class="phone-only">today’s </span>wellness' : 'Log wellness'} ›</button>
      <button class="btn-reset" aria-expanded="false" aria-controls="wellnessPanelHistory" onclick="toggleWellnessPanel('history')">Last 7 days ›</button>
    </div>
    <div class="readiness__panel" id="wellnessPanelForm" hidden>${wellnessFormHtml(key, e || {})}</div>
    <div class="readiness__panel" id="wellnessPanelHistory" hidden>${wellnessHistoryHtml(now) || '<p class="card-text">No entries in the last 7 days.</p>'}</div>`;
  card.style.display = '';
}

// Show one of the two panels under the readiness card (the other closes)
function toggleWellnessPanel(which, forceOpen) {
  for (const [k, id] of [['form', 'wellnessPanelForm'], ['history', 'wellnessPanelHistory']]) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    const open = k === which ? (forceOpen === true ? true : panel.hidden) : false;
    panel.hidden = !open;
    document.querySelector(`[aria-controls="${id}"]`)?.setAttribute('aria-expanded', String(open));
  }
}

function wellnessFormHtml(dateKey, e) {
  const input = f => f.type === 'scale'
    ? `<select class="select" id="well_${f.key}" aria-label="${f.label}"><option value="">—</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${e[f.key] === n ? ' selected' : ''}>${n}</option>`).join('')}</select>`
    : `<input class="input" type="number" inputmode="decimal" id="well_${f.key}" aria-label="${f.label}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${e[f.key] ?? ''}">`;
  return `<form class="wellness-form" onsubmit="event.preventDefault(); saveWellnessFromForm('${dateKey}')">
    <div class="wellness-grid">${WELLNESS_FIELDS.map(f => `<label class="wellness-field"><span>${f.label} <small>${f.unit}</small></span>${input(f)}</label>`).join('')}</div>
    <label class="wellness-field" style="margin-top:12px"><span>Notes</span><input class="input" id="well_notes" value="${escapeHtml(e.notes || '')}" maxlength="2000" placeholder="Illness, travel, niggles…"></label>
    <button class="btn btn--primary btn--block" type="submit">Save</button>
  </form>`;
}

function wellnessHistoryHtml(now) {
  const days = Array.from({ length: 7 }, (_, i) => localDateKey(addDays(now, -i)));
  if (!days.some(d => wellnessEntries[d])) return '';
  const cell = (d, k) => { const v = wellnessEntries[d]?.[k]; return v == null ? '—' : escapeHtml(v); };
  const rows = days.map(d => `<tr><td>${escapeHtml(parseIsoDate(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }))}</td><td>${cell(d, 'restingHr')}</td><td>${cell(d, 'hrv')}</td><td>${cell(d, 'sleepHours')}</td><td>${cell(d, 'soreness')}</td><td>${cell(d, 'weight')}</td></tr>`).join('');
  return `<div class="plan-steps-wrap"><table class="plan-steps"><thead><tr><th>Day</th><th>RHR</th><th>HRV</th><th>Sleep</th><th>Sore</th><th>Kg</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
