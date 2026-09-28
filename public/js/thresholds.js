// ══════════════════════════════════════════════
// Threshold history
// ══════════════════════════════════════════════
// Thresholds change over a season. Each entry applies from its `from` date until the next entry,
// so an activity is always scored with the FTP / LTHR / paces that were valid when it happened.
// Entries: { from: 'YYYY-MM-DD', ftp, lthr, pace: 'm:ss' (per km), swimPace: 'm:ss' (per 100m) },
// kept sorted by `from`. Activities before the first entry use the first entry.

let thresholdHistory = [];
const DEFAULT_THRESHOLDS = { ftp: 200, lthr: 165, pace: '5:00', swimPace: '2:00' };
const THRESHOLDS_FROM_START = '2000-01-01';

function isPace(s) { return /^\d{1,2}:[0-5]\d$/.test(String(s || '').trim()); }

// Values currently typed in the Settings panel
function readThresholdInputs() {
  const v = id => document.getElementById(id)?.value;
  return {
    ftp: +v('inputFtp') || DEFAULT_THRESHOLDS.ftp,
    lthr: +v('inputLthr') || DEFAULT_THRESHOLDS.lthr,
    pace: isPace(v('inputPace')) ? v('inputPace').trim() : DEFAULT_THRESHOLDS.pace,
    swimPace: isPace(v('inputSwimPace')) ? v('inputSwimPace').trim() : DEFAULT_THRESHOLDS.swimPace,
  };
}

// Clean, de-duplicated (last one per date wins) and sorted copy of a stored history
function normalizeThresholdHistory(list) {
  const byDate = new Map();
  for (const h of Array.isArray(list) ? list : []) {
    if (!h || !/^\d{4}-\d{2}-\d{2}$/.test(h.from)) continue;
    byDate.set(h.from, {
      from: h.from,
      ftp: +h.ftp > 0 ? +h.ftp : DEFAULT_THRESHOLDS.ftp,
      lthr: +h.lthr > 0 ? +h.lthr : DEFAULT_THRESHOLDS.lthr,
      pace: isPace(h.pace) ? h.pace : DEFAULT_THRESHOLDS.pace,
      swimPace: isPace(h.swimPace) ? h.swimPace : DEFAULT_THRESHOLDS.swimPace,
    });
  }
  return [...byDate.values()].sort((a, b) => a.from.localeCompare(b.from));
}

// Thresholds valid on a given date (falls back to the Settings inputs before data is loaded)
function thresholdsAt(date) {
  if (!thresholdHistory.length) return readThresholdInputs();
  const key = localDateKey(date instanceof Date && !isNaN(date) ? date : new Date());
  let t = thresholdHistory[0];
  for (const h of thresholdHistory) { if (h.from <= key) t = h; else break; }
  return t;
}

function currentThresholds() { return thresholdHistory.length ? thresholdHistory[thresholdHistory.length - 1] : readThresholdInputs(); }

// Add or replace the entry starting on `entry.from`. Returns the new history.
function upsertThresholds(history, entry) {
  return normalizeThresholdHistory([...history.filter(h => h.from !== entry.from), entry]);
}

function fillThresholdInputs(t) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('inputFtp', t.ftp); set('inputLthr', t.lthr); set('inputPace', t.pace); set('inputSwimPace', t.swimPace);
}

// Settings panel: "Save thresholds" — validates, records them from the chosen date, rescored TSS
async function saveThresholdsFromInputs() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const errors = [];
  if (!(+v('inputFtp') > 0)) errors.push('FTP must be a positive number of watts');
  if (!(+v('inputLthr') > 0)) errors.push('LTHR must be a positive number of bpm');
  if (!isPace(v('inputPace'))) errors.push('Threshold pace must look like 4:30');
  if (!isPace(v('inputSwimPace'))) errors.push('Swim CSS pace must look like 1:45');
  const from = v('inputThresholdFrom') || localDateKey(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) errors.push('Pick an "effective from" date');
  if (errors.length) { showToast(errors.join(' · '), '⚠️'); return false; }
  thresholdHistory = upsertThresholds(thresholdHistory, { from, ...readThresholdInputs() });
  renderThresholdHistory();
  if (typeof saveThresholdHistory === 'function') await saveThresholdHistory(thresholdHistory);
  recalcAll();
  showToast(`Thresholds saved from ${from}`, '✅');
  return true;
}

async function deleteThresholdEntry(from) {
  if (thresholdHistory.length <= 1) { showToast('Keep at least one set of thresholds', '⚠️'); return; }
  if (!confirm(`Delete the thresholds starting ${from}? Activities in that period will be rescored with the previous values.`)) return;
  thresholdHistory = thresholdHistory.filter(h => h.from !== from);
  fillThresholdInputs(currentThresholds());
  renderThresholdHistory();
  if (typeof saveThresholdHistory === 'function') await saveThresholdHistory(thresholdHistory);
  recalcAll();
}

function renderThresholdHistory() {
  const el = document.getElementById('thresholdHistory');
  if (!el) return;
  if (!thresholdHistory.length) { el.innerHTML = ''; return; }
  const rows = [...thresholdHistory].reverse().map((h, i) => {
    const from = h.from === THRESHOLDS_FROM_START ? 'start' : h.from;
    return `<tr><td>${escapeHtml(from)}${i === 0 ? ' <span class="plan-version">current</span>' : ''}</td><td>${escapeHtml(h.ftp)} W</td><td>${escapeHtml(h.lthr)} bpm</td><td>${escapeHtml(h.pace)}/km</td><td>${escapeHtml(h.swimPace)}/100m</td>
      <td><button class="btn-reset threshold-del" data-from="${escapeHtml(h.from)}" onclick="deleteThresholdEntry(this.dataset.from)" aria-label="Delete thresholds from ${escapeHtml(from)}"${thresholdHistory.length <= 1 ? ' disabled' : ''}>✕</button></td></tr>`;
  }).join('');
  el.innerHTML = `<div class="plan-steps-wrap"><table class="plan-steps"><thead><tr><th>From</th><th>FTP</th><th>LTHR</th><th>Run pace</th><th>Swim CSS</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
