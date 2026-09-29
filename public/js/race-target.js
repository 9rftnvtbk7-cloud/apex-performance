// ══════════════════════════════════════════════
// Race-day targets (Planner)
// ══════════════════════════════════════════════
// "To be at CTL X and TSB Y on race day, what load do I need?" Model: a constant daily load L until the
// taper, then f·L for the last `taperDays` days. Race-day values are those of the race morning (after
// the day before). For a fixed f, race-day CTL is linear in L, so L follows from the CTL target; f is
// then searched to get closest to the TSB target.

let raceTargetResult = null;

// Daily simulation from today's CTL/ATL; loads[i] is the TSS of day i (0 = today)
function simulateLoads(ctl0, atl0, loads) {
  let ctl = ctl0, atl = atl0;
  const ctlByDay = [];
  for (const l of loads) { ctl += (l - ctl) / 42; atl += (l - atl) / 7; ctlByDay.push(ctl); }
  return { ctl, atl, tsb: ctl - atl, ctlByDay };
}

function dailyLoads(days, taperDays, L, f) {
  return Array.from({ length: days }, (_, i) => (i >= days - taperDays ? f * L : L));
}

// → { ok, L, f, loads, ctl, tsb, maxRamp, warnings[] }
function solveRaceTarget({ ctl0, atl0, days, taperDays, targetCtl, targetTsb }) {
  const warnings = [];
  if (!(days >= 7)) return { ok: false, warnings: ['The race is less than a week away: there is no time to change fitness meaningfully.'] };
  taperDays = Math.max(0, Math.min(Math.round(taperDays), days - 1));
  let best = null;
  for (let f = 0.1; f <= 1.0001; f += 0.01) {
    // CTL_end is linear in L: CTL_end(L) = CTL_end(0) + L · slope
    const c0 = simulateLoads(ctl0, atl0, dailyLoads(days, taperDays, 0, f)).ctl;
    const c1 = simulateLoads(ctl0, atl0, dailyLoads(days, taperDays, 1, f)).ctl;
    const L = Math.max(0, (targetCtl - c0) / (c1 - c0));
    const sim = simulateLoads(ctl0, atl0, dailyLoads(days, taperDays, L, f));
    const err = Math.abs(sim.tsb - targetTsb) + Math.abs(sim.ctl - targetCtl) * 2;
    if (!best || err < best.err) best = { f: Math.round(f * 100) / 100, L, sim, err };
  }
  const loads = dailyLoads(days, taperDays, best.L, best.f);
  // Largest 7-day CTL increase during the build
  let maxRamp = 0;
  const c = best.sim.ctlByDay;
  for (let i = 7; i < c.length; i++) maxRamp = Math.max(maxRamp, c[i] - c[i - 7]);
  maxRamp = Math.max(maxRamp, c.length >= 7 ? c[Math.min(6, c.length - 1)] - ctl0 : 0);
  if (Math.abs(best.sim.ctl - targetCtl) > 1) warnings.push(`CTL ${targetCtl} can't be reached — best is ${best.sim.ctl.toFixed(0)}.`);
  if (Math.abs(best.sim.tsb - targetTsb) > 3) warnings.push(`With this fitness target, race-day form would be ${best.sim.tsb > 0 ? '+' : ''}${best.sim.tsb.toFixed(0)} instead of ${targetTsb > 0 ? '+' : ''}${targetTsb}. Try a longer taper or a lower CTL target.`);
  if (maxRamp > 8) warnings.push(`Ramp up to ${maxRamp.toFixed(1)} CTL/week — above ~8/week the risk of injury and illness rises. Consider a lower target.`);
  else if (maxRamp > 5) warnings.push(`Ramp up to ${maxRamp.toFixed(1)} CTL/week: an aggressive but common build.`);
  return { ok: true, L: best.L, f: best.f, loads, taperDays, ctl: best.sim.ctl, tsb: best.sim.tsb, maxRamp, warnings };
}

// Weekly TSS (Monday-based weeks) from daily loads starting today; `days` < 7 for partial weeks
function weeklyFromDaily(loads, today) {
  const weeks = new Map();
  loads.forEach((l, i) => {
    const d = addDays(today, i), mon = localDateKey(addDays(d, -((d.getDay() + 6) % 7)));
    const w = weeks.get(mon) || { tss: 0, days: 0 };
    w.tss += l; w.days++;
    weeks.set(mon, w);
  });
  return [...weeks].map(([monday, w]) => ({ monday, tss: Math.round(w.tss), days: w.days }));
}

function renderRaceTargetForm() {
  const sel = document.getElementById('raceTargetRace');
  if (!sel) return;
  const today = localDateKey(new Date());
  const races = (raceDates || []).filter(r => r.date && r.date > today).sort((a, b) => a.date.localeCompare(b.date));
  const prev = sel.value;
  sel.innerHTML = races.length ? races.map(r => `<option value="${escapeHtml(r.date)}">${escapeHtml(r.name || 'Race')} · ${escapeHtml(r.date)}</option>`).join('') : '<option value="">Add a race date above</option>';
  if (races.some(r => r.date === prev)) sel.value = prev;
  const ctlInput = document.getElementById('raceTargetCtl');
  if (ctlInput && !ctlInput.value && pmcResult.lastCtl != null) ctlInput.value = Math.round(pmcResult.lastCtl + 10);
}

function calculateRaceTarget() {
  const out = document.getElementById('raceTargetResult');
  const raceKey = document.getElementById('raceTargetRace').value;
  const race = parseIsoDate(raceKey);
  if (!race) { out.innerHTML = '<div class="insight-muted">Add a future race date first (🏁 Race dates above).</div>'; return; }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((race - today) / 86400000); // loads for today … the day before the race
  const r = solveRaceTarget({
    ctl0: pmcResult.lastCtl || 0, atl0: pmcResult.lastAtl || 0, days,
    taperDays: +document.getElementById('raceTargetTaper').value || 10,
    targetCtl: +document.getElementById('raceTargetCtl').value || 0,
    targetTsb: +document.getElementById('raceTargetTsb').value || 0,
  });
  raceTargetResult = r.ok ? { ...r, weeks: weeklyFromDaily(r.loads, today) } : null;
  if (!r.ok) { out.innerHTML = `<div class="insight-muted">${escapeHtml(r.warnings[0])}</div>`; return; }
  const rows = raceTargetResult.weeks.map(w => `<tr><td>${escapeHtml(parseIsoDate(w.monday).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</td>${w.days < 7 ? ` <small>(${w.days} d)</small>` : ''}</td><td>${w.tss}</td><td>${Math.round(w.tss / w.days)}</td></tr>`).join('');
  out.innerHTML = `
    <div class="race-target-summary">
      <div><span class="insight-stat-value">${Math.round(r.L * 7)}</span><span class="insight-stat-label">TSS / week during the build (${Math.round(r.L)}/day)</span></div>
      <div><span class="insight-stat-value">${Math.round(r.f * 100)}%</span><span class="insight-stat-label">of that load in the ${r.taperDays}-day taper</span></div>
      <div><span class="insight-stat-value">${r.ctl.toFixed(0)} / ${r.tsb > 0 ? '+' : ''}${r.tsb.toFixed(0)}</span><span class="insight-stat-label">race-day CTL / TSB</span></div>
    </div>
    ${r.warnings.length ? `<ul class="readiness-reasons">${r.warnings.map(w => `<li class="is-caution">${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
    <details class="wellness-history"><summary>Weekly plan (${raceTargetResult.weeks.length} weeks)</summary><div class="plan-steps-wrap"><table class="plan-steps"><thead><tr><th>Week of</th><th>TSS</th><th>Per day</th></tr></thead><tbody>${rows}</tbody></table></div></details>
    <button class="btn-base btn-upload" style="margin-top:10px" onclick="applyRaceTargetToPlanner()">Apply to planner</button>`;
}

// Fill the Planner weeks that the race target covers (others unchanged)
function applyRaceTargetToPlanner() {
  if (!raceTargetResult || !plannerData.length) return;
  const byWeek = Object.fromEntries(raceTargetResult.weeks.map(w => [w.monday, w.tss]));
  let n = 0;
  for (const p of plannerData) { const k = localDateKey(p.weekStart); if (k in byWeek) { p.tss = byWeek[k]; n++; } }
  renderPlannerGrid(); updatePlannerForecast();
  if (typeof savePlannerData === 'function') savePlannerData();
  showToast(`Planner updated: ${n} week${n > 1 ? 's' : ''}`, '✅');
}
