// ══════════════════════════════════════════════
// Calendar: planned vs completed, compliance colours, move sessions
// ══════════════════════════════════════════════
// Month or week view (Monday first). Planned sessions come from the training plan (moved sessions
// use planOverrides), completed ones from activities. Compliance per planned session:
//   green  : matched activity with 80–120% of planned TSS (or ticked / no planned TSS)
//   amber  : matched with 50–80% or 120–150%
//   red    : matched outside 50–150%, or missed (past, not done)
//   neutral: today or future
// Move a session by dragging it to another day, or tap it → "Move to".

let calendarCursor = null;   // any date inside the displayed month/week
let calendarView = null;     // 'month' | 'week' (default: week on phones)
let calendarDragId = null;

function complianceOf(session, matched, date, today) {
  if (session.sport === 'rest') return 'rest';
  if (matched) {
    if (!(session.tss > 0)) return 'green';
    const r = (matched.tss || 0) / session.tss;
    if (r >= 0.8 && r <= 1.2) return 'green';
    if (r >= 0.5 && r <= 1.5) return 'amber';
    return 'red';
  }
  if (isSessionTicked(session)) return 'green';
  if (date && date < today) return 'red';
  return 'planned';
}

// All planned sessions with their (possibly moved) date, keyed by YYYY-MM-DD
function plannedByDay(plan) {
  const map = {};
  if (!plan) return map;
  for (const week of plan.weeks || []) {
    const start = planWeekStart(week, plan);
    for (const s of week.sessions || []) {
      const d = sessionDateFor(s, start);
      if (d) (map[localDateKey(d)] ||= []).push({ s, date: d });
    }
  }
  return map;
}

// "W01 Mon – Vélo Tempo" → "Vélo Tempo": the calendar position already says the week and day
function calendarSessionName(name) { return String(name || '').replace(/^W\d+\s+[A-Za-zÀ-ÿ]{2,}\.?\s*[–—-]\s*/, '') || String(name || ''); }

function calendarRange() {
  const cur = calendarCursor || new Date();
  const monday = d => addDays(d, -((d.getDay() + 6) % 7));
  if (calendarView === 'week') { const s = monday(cur); return { start: s, end: addDays(s, 6), title: `Week of ${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` }; }
  const first = new Date(cur.getFullYear(), cur.getMonth(), 1), last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
  return { start: monday(first), end: addDays(monday(last), 6), title: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
}

function calendarShift(dir) {
  const cur = calendarCursor || new Date();
  calendarCursor = calendarView === 'week' ? addDays(cur, 7 * dir) : new Date(cur.getFullYear(), cur.getMonth() + dir, 1);
  renderCalendar();
}
function calendarToday() { calendarCursor = new Date(); renderCalendar(); }
function setCalendarView(v) { calendarView = v; renderCalendar(); }

function renderCalendar(now = new Date()) {
  const box = document.getElementById('calendarGrid');
  if (!box) return;
  if (!calendarView) calendarView = window.matchMedia && window.matchMedia('(max-width: 600px)').matches ? 'week' : 'month';
  document.querySelectorAll('.cal-view-btn').forEach(b => { const on = b.dataset.view === calendarView; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const { start, end, title } = calendarRange();
  document.getElementById('calendarTitle').textContent = title;
  const planned = plannedByDay(trainingPlan);
  const matches = trainingPlan ? matchPlanToActivities(trainingPlan) : new Map();
  const matchedActs = new Set(matches.values());
  const actsByDay = {};
  for (const a of allActivities) (actsByDay[localDateKey(a.startDate)] ||= []).push(a);
  const month = (calendarCursor || now).getMonth();
  const sportEmojis = { bike: '🚴', run: '🏃', swim: '🏊', strength: '💪', 'strength+swim': '💪🏊', rest: '😴', race: '🏁' };

  let html = `<div class="cal-grid cal-grid--${calendarView}">`;
  if (calendarView === 'month') html += ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map(d => `<div class="cal-head">${d}</div>`).join('');
  for (let ws = start; ws <= end; ws = addDays(ws, 7)) {
    let plannedTss = 0, actualTss = 0, plannedSoFar = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), key = localDateKey(d);
      const sessions = planned[key] || [], acts = actsByDay[key] || [];
      const dayPlanned = sessions.reduce((n, x) => n + (x.s.tss || 0), 0);
      plannedTss += dayPlanned;
      if (d < today) plannedSoFar += dayPlanned; // today's session may still be ahead
      actualTss += acts.reduce((n, a) => n + (a.tss || 0), 0);
      const chips = sessions.map(({ s }) => {
        const m = matches.get(s.id), c = complianceOf(s, m, d, today);
        return `<button class="btn-reset cal-chip cal-chip--${c}" draggable="true" data-session-id="${escapeHtml(s.id)}"
          ondragstart="calendarDragId=this.dataset.sessionId; event.dataTransfer.setData('text/plain', this.dataset.sessionId)"
          onclick="openSessionDialog(this.dataset.sessionId)" title="${escapeHtml(s.name)}${m ? ` — actual ${m.tss} TSS` : ''}">
          ${sportEmojis[s.sport] || '🏋️'} <span class="cal-chip-name">${escapeHtml(calendarSessionName(s.name))}</span>${s.tss ? ` <small>${escapeHtml(s.tss)}${m ? `→${escapeHtml(m.tss)}` : ''}</small>` : ''}${planOverrides[s.id] ? ' ↪' : ''}</button>`;
      }).join('') + acts.filter(a => !matchedActs.has(a)).map(a =>
        `<button class="btn-reset cal-chip cal-chip--unplanned" data-id="${escapeHtml(a.id || '')}" onclick="if (this.dataset.id) openActivityDetail(this.dataset.id)" title="Unplanned: ${escapeHtml(a.name || fmtSportName(a.sport))}">${sportEmoji(a.sport)} <span class="cal-chip-name">${escapeHtml(a.name || fmtSportName(a.sport))}</span> <small>${escapeHtml(a.tss || 0)}</small></button>`).join('');
      const cls = ['cal-day', key === localDateKey(today) ? 'is-today' : '', calendarView === 'month' && d.getMonth() !== month ? 'is-other-month' : ''].filter(Boolean).join(' ');
      const label = calendarView === 'week' ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : d.getDate();
      html += `<div class="${cls}" data-date="${key}" ondragover="event.preventDefault(); this.classList.add('is-drop')" ondragleave="this.classList.remove('is-drop')"
        ondrop="event.preventDefault(); this.classList.remove('is-drop'); moveSession(event.dataTransfer.getData('text/plain') || calendarDragId, this.dataset.date)">
        <div class="cal-date">${escapeHtml(label)}</div>${chips}</div>`;
    }
    // Finished weeks: actual vs planned. Current week: vs what was planned up to today.
    const inProgress = ws <= today && addDays(ws, 6) >= today;
    const base = inProgress ? plannedSoFar : plannedTss;
    const pct = base && ws <= today ? Math.round(actualTss / base * 100) : null;
    const wc = pct == null ? 'planned' : pct >= 80 && pct <= 120 ? 'green' : pct >= 50 && pct <= 150 ? 'amber' : 'red';
    html += `<div class="cal-week cal-week--${wc}"><div class="cal-week-label">Week${inProgress ? ' so far' : ''}</div><div>${actualTss} / ${(inProgress ? plannedSoFar : plannedTss) || '—'} TSS</div>${pct != null ? `<div><strong>${pct}%</strong></div>` : ''}${inProgress && plannedTss ? `<div class="cal-week-plan">plan ${plannedTss}</div>` : ''}</div>`;
  }
  html += '</div>';
  box.innerHTML = html;
}

// ── Move a planned session to another date ──
async function moveSession(sessionId, dateKey) {
  if (!sessionId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return;
  const found = findPlanSession(sessionId);
  if (!found) return;
  const original = planSessionDate(planWeekStart(found.week, trainingPlan), found.s.day);
  if (original && localDateKey(original) === dateKey) delete planOverrides[sessionId];  // back to its planned day
  else planOverrides[sessionId] = dateKey;
  if (typeof savePlanOverrides === 'function') await savePlanOverrides(planOverrides);
  renderTrainingPlan();
  renderCalendar();
  showToast(`${found.s.name} → ${parseIsoDate(dateKey).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`, '📅');
}

function findPlanSession(sessionId) {
  for (const week of trainingPlan?.weeks || []) for (const s of week.sessions || []) if (s.id === sessionId) return { week, s };
  return null;
}

// Tap a session: details, tick, move to another date, reset to the planned day
function openSessionDialog(sessionId) {
  const found = findPlanSession(sessionId);
  const dlg = document.getElementById('sessionDialog');
  if (!found || !dlg) return;
  const { week, s } = found;
  const start = planWeekStart(week, trainingPlan);
  const date = sessionDateFor(s, start), original = planSessionDate(start, s.day);
  const m = trainingPlan ? matchPlanToActivities(trainingPlan).get(s.id) : null;
  document.getElementById('sessionDialogBody').innerHTML = `
    <div class="detail-head"><div style="min-width:0"><div class="detail-title">${escapeHtml(s.name)}</div>
      <div class="plan-subtitle">W${escapeHtml(week.week)} · ${date ? escapeHtml(date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })) : ''}${s.tss ? ` · TSS ${escapeHtml(s.tss)}` : ''}</div></div>
      <button class="btn-reset detail-close" onclick="document.getElementById('sessionDialog').close()" aria-label="Close">✕</button></div>
    ${s.description ? `<div class="plan-session-desc">${escapeHtml(s.description)}</div>` : ''}${sessionMetaHtml(s)}
    ${m ? `<div style="margin-top:10px"><span class="plan-session-actual">✓ ${escapeHtml(m.tss)} TSS actual</span> <button class="btn-reset empty-state-link" data-id="${escapeHtml(m.id || '')}" onclick="document.getElementById('sessionDialog').close(); openActivityDetail(this.dataset.id)">Open activity</button></div>`
        : s.sport !== 'rest' ? `<label class="session-tick"><input type="checkbox" ${isSessionTicked(s) ? 'checked' : ''} data-session-id="${escapeHtml(s.id)}" onchange="toggleSessionComplete(this.dataset.sessionId); renderCalendar();"> Done</label>` : ''}
    <div class="session-move">
      <label class="settings-label" for="sessionMoveDate" style="margin:0">Move to</label>
      <input type="date" class="compare-date-input" id="sessionMoveDate" value="${date ? localDateKey(date) : ''}">
      <button class="btn-base btn-upload" data-session-id="${escapeHtml(s.id)}" onclick="moveSession(this.dataset.sessionId, document.getElementById('sessionMoveDate').value); document.getElementById('sessionDialog').close();">Move</button>
      ${planOverrides[s.id] && original ? `<button class="btn-base btn-ghost" data-session-id="${escapeHtml(s.id)}" data-date="${localDateKey(original)}" onclick="moveSession(this.dataset.sessionId, this.dataset.date); document.getElementById('sessionDialog').close();">Back to ${escapeHtml(original.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }))}</button>` : ''}
    </div>
    ${sessionDetailsHtml(s).replace('<details class="plan-session-details">', '<details class="plan-session-details" open>')}`;
  if (!dlg.open) dlg.showModal();
}
