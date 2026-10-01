// ══════════════════════════════════════════════
// Calendar: planned vs completed, compliance colours, move sessions
// ══════════════════════════════════════════════
// The Plan tab shows the same plan three ways: Week and Month (this calendar) and List (renderTrainingPlan).
// Month or week view (Monday first). Planned sessions come from the training plan (moved sessions
// use planOverrides), completed ones from activities. Compliance per planned session:
//   green  : matched activity with ≥ 80% of planned TSS — going over counts as done (or ticked / no planned TSS)
//   amber  : matched with 50–80%
//   red    : matched below 50%, or missed (past, not done)
// Strength sessions compare time with the planned duration instead of TSS.
//   neutral: today or future
// Move a session by dragging it to another day, or tap it → "Move to".

let calendarCursor = null;   // any date inside the displayed month/week
let calendarView = null;     // 'month' | 'week' (default: week on phones)
let planView = null;         // Plan tab: 'week' | 'month' | 'list'
let calendarDragId = null;

function complianceOf(session, matched, date, today) {
  if (session.sport === 'rest') return 'rest';
  if (matched) {
    const byTime = sportKey(session.sport) === 'strength' && session.durationMin > 0;
    if (!byTime && !(session.tss > 0)) return 'green';
    const r = byTime ? (matched.duration || 0) / 60 / session.durationMin : (matched.tss || 0) / session.tss;
    if (r >= 0.8) return 'green';
    if (r >= 0.5) return 'amber';
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

// Plan tab: Week / Month calendar or the List of every week
function setPlanView(v) {
  if (!calendarView) calendarView = window.matchMedia && window.matchMedia('(max-width: 1023px)').matches ? 'week' : 'month';
  planView = ['week', 'month', 'list'].includes(v) ? v : (planView || calendarView);
  if (planView !== 'list') calendarView = planView;
  document.querySelectorAll('.plan-view-btn').forEach(b => { const on = b.dataset.view === planView; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  document.getElementById('planCalendarPanel')?.classList.toggle('is-active', planView !== 'list');
  document.getElementById('planListPanel')?.classList.toggle('is-active', planView === 'list');
  if (planView === 'list') { if (typeof scrollToCurrentWeek === 'function') scrollToCurrentWeek(); }
  else renderCalendar();
}

const COMPLIANCE = {
  green: { glyph: '✓', word: 'Done' }, amber: { glyph: '◐', word: 'Partly' }, red: { glyph: '✕', word: 'Missed' },
  planned: { glyph: '○', word: 'Planned' }, rest: { glyph: '', word: 'Rest' }, unplanned: { glyph: '+', word: 'Unplanned' },
};

// Planned vs actual for the 7 days starting on Monday `ws`
function calendarWeekData(ws, today, planned, actsByDay) {
  let plannedTss = 0, actualTss = 0, plannedSoFar = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i), key = localDateKey(d);
    const dayPlanned = (planned[key] || []).reduce((n, x) => n + (x.s.tss || 0), 0);
    plannedTss += dayPlanned;
    if (d < today) plannedSoFar += dayPlanned; // today's session may still be ahead
    actualTss += (actsByDay[key] || []).reduce((n, a) => n + (a.tss || 0), 0);
  }
  const inProgress = ws <= today && addDays(ws, 6) >= today;
  const base = inProgress ? plannedSoFar : plannedTss;
  const pct = base && ws <= today ? Math.round(actualTss / base * 100) : null;
  const status = pct == null ? 'planned' : pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red';
  return { plannedTss, actualTss, plannedSoFar, inProgress, pct, status, future: ws > today };
}

function renderCalendar(now = new Date()) {
  const box = document.getElementById('calendarGrid');
  if (!box) return;
  if (!calendarView) calendarView = window.matchMedia && window.matchMedia('(max-width: 1023px)').matches ? 'week' : 'month';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const { start, end, title } = calendarRange();
  const planned = plannedByDay(trainingPlan);
  const matches = trainingPlan ? matchPlanToActivities(trainingPlan) : new Map();
  const matchedActs = new Set(matches.values());
  const actsByDay = {};
  for (const a of allActivities) (actsByDay[localDateKey(a.startDate)] ||= []).push(a);
  const ctx = { today, planned, matches, matchedActs, actsByDay };

  if (calendarView === 'week') {
    const week = trainingPlan && (trainingPlan.weeks || []).find(w => { const st = planWeekStart(w, trainingPlan); return st && localDateKey(st) === localDateKey(start); });
    const range = `${start.getDate()}${start.getMonth() !== end.getMonth() ? ' ' + start.toLocaleDateString('en-GB', { month: 'short' }) : ''} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    document.getElementById('calendarTitle').textContent = week ? `W${String(week.week).padStart(2, '0')} · ${range}` : range;
    document.getElementById('calendarSub').textContent = week && week.phase ? `${week.phase[0]}${week.phase.slice(1).toLowerCase()} phase` : '';
    box.innerHTML = calendarWeekHtml(start, ctx);
  } else {
    document.getElementById('calendarTitle').textContent = title;
    document.getElementById('calendarSub').textContent = '';
    box.innerHTML = calendarMonthHtml(start, end, ctx, (calendarCursor || now).getMonth());
  }
}

// Drag & drop attributes shared by month cells and week rows
function calDropAttrs(key) {
  return `data-date="${key}" ondragover="event.preventDefault(); this.classList.add('is-drop')" ondragleave="this.classList.remove('is-drop')"
    ondrop="event.preventDefault(); this.classList.remove('is-drop'); moveSession(event.dataTransfer.getData('text/plain') || calendarDragId, this.dataset.date)"`;
}
function calDragAttrs() { return `draggable="true" ondragstart="calendarDragId=this.dataset.sessionId; event.dataTransfer.setData('text/plain', this.dataset.sessionId)"`; }

function calendarMonthHtml(start, end, { today, planned, matches, matchedActs, actsByDay }, month) {
  let html = '<div class="cal-grid cal-grid--month">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Week'].map(d => `<div class="cal-head">${d}</div>`).join('');
  for (let ws = start; ws <= end; ws = addDays(ws, 7)) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), key = localDateKey(d);
      const chips = (planned[key] || []).map(({ s }) => {
        const m = matches.get(s.id), c = complianceOf(s, m, d, today), k = COMPLIANCE[c];
        const meta = s.sport === 'rest' ? '' : `<span class="cal-chip-meta"><span class="cal-chip-glyph" aria-hidden="true">${k.glyph}</span><small>${escapeHtml(s.tss || 0)}${m ? '→' + escapeHtml(m.tss) : ''}</small>${planOverrides[s.id] ? ' ↪' : ''}</span>`;
        return `<button class="btn-reset cal-chip cal-chip--${c}" ${calDragAttrs()} data-session-id="${escapeHtml(s.id)}" style="--sport:var(--sport-${sportKey(s.sport)})"
          onclick="openSessionDialog(this.dataset.sessionId)" aria-label="${escapeHtml(s.name)}, ${k.word.toLowerCase()}"><span class="cal-chip-name">${escapeHtml(calendarSessionName(s.name))}</span>${meta}</button>`;
      }).join('') + (actsByDay[key] || []).filter(a => !matchedActs.has(a)).map(a =>
        `<button class="btn-reset cal-chip cal-chip--unplanned" data-id="${escapeHtml(a.id || '')}" style="--sport:var(--sport-${sportKey(a.sport)})" onclick="if (this.dataset.id) openActivityDetail(this.dataset.id)" aria-label="${escapeHtml(a.name || fmtSportName(a.sport))}, unplanned"><span class="cal-chip-name">${escapeHtml(a.name || fmtSportName(a.sport))}</span><span class="cal-chip-meta"><span class="cal-chip-glyph" aria-hidden="true">+</span><small>${escapeHtml(a.tss || 0)}</small></span></button>`).join('');
      const cls = ['cal-day', key === localDateKey(today) ? 'is-today' : '', d.getMonth() !== month ? 'is-other-month' : ''].filter(Boolean).join(' ');
      html += `<div class="${cls}" ${calDropAttrs(key)}><div class="cal-date"><span>${d.getDate()}</span></div>${chips}</div>`;
    }
    const w = calendarWeekData(ws, today, planned, actsByDay);
    const pctText = w.inProgress ? (w.pct == null ? '' : w.pct >= 80 ? 'on track' : `${w.pct} % so far`) : w.pct != null ? `${w.pct} %` : '';
    html += `<div class="cal-week cal-week--${w.inProgress && w.pct != null && w.pct >= 80 ? 'green' : w.status}"><b>${w.future ? '—' : w.actualTss}</b><span>of ${w.plannedTss || '—'} TSS</span>${pctText ? `<em>${pctText}</em>` : ''}</div>`;
  }
  return html + '</div>';
}

function calendarWeekHtml(ws, { today, planned, matches, matchedActs, actsByDay }) {
  const w = calendarWeekData(ws, today, planned, actsByDay);
  const shown = w.inProgress ? w.plannedSoFar : w.plannedTss;
  const pctStatus = w.pct == null ? '' : `<span class="${w.status === 'green' ? 'is-ok' : w.status === 'amber' ? 'is-caution' : 'is-missed'}">${w.status === 'green' ? '✓ ' : ''}${w.pct} %</span>`;
  const barPct = shown ? Math.min(100, Math.round(w.actualTss / shown * 100)) : 0;
  let html = `<div class="card cal-summary">
    <div class="cal-summary__top"><div><span class="cal-summary__value">${w.future ? 0 : w.actualTss}</span><span class="cal-summary__of">/ ${shown || w.plannedTss || '—'} TSS${w.inProgress ? ' so far' : ''}</span></div>${pctStatus}</div>
    <div class="cal-bar"><i style="width:${barPct}%"></i></div>
    <p class="card-text" style="margin:0">${w.plannedTss ? `Plan for the week ${w.plannedTss}${w.inProgress ? ' · today not counted until done' : ''}` : 'No plan for this week'}</p>
  </div><div class="cal-rows">`;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i), key = localDateKey(d);
    const rows = (planned[key] || []).map(({ s }) => {
      const m = matches.get(s.id), c = complianceOf(s, m, d, today), k = COMPLIANCE[c];
      const meta = m ? [fmtDuration(m.duration), 'from Strava'].filter(x => x && x !== '—').join(' · ') : sessionMetaText(s) || (s.description || '').slice(0, 60);
      return `<button class="btn-reset cal-chip cal-chip--row cal-chip--${c}" ${calDragAttrs()} data-session-id="${escapeHtml(s.id)}" style="--sport:var(--sport-${sportKey(s.sport)})"
        onclick="openSessionDialog(this.dataset.sessionId)" aria-label="${escapeHtml(s.name)}, ${k.word.toLowerCase()}">
        <span class="cal-chip-glyph" aria-hidden="true">${k.glyph}</span>
        <span class="cal-chip__main"><span class="cal-chip-name">${sportDot(s.sport)}<span>${escapeHtml(s.name)}</span>${planOverrides[s.id] ? ' ↪' : ''}</span>${meta ? `<span class="cal-chip-meta">${escapeHtml(meta)}</span>` : ''}</span>
        <span class="cal-chip__right"><b>${escapeHtml(m ? m.tss : s.tss || 0)}</b><small>${k.word}</small></span></button>`;
    }).join('') + (actsByDay[key] || []).filter(a => !matchedActs.has(a)).map(a =>
      `<button class="btn-reset cal-chip cal-chip--row cal-chip--unplanned" data-id="${escapeHtml(a.id || '')}" style="--sport:var(--sport-${sportKey(a.sport)})" onclick="if (this.dataset.id) openActivityDetail(this.dataset.id)">
        <span class="cal-chip-glyph" aria-hidden="true">+</span>
        <span class="cal-chip__main"><span class="cal-chip-name">${sportDot(a.sport)}<span>${escapeHtml(a.name || fmtSportName(a.sport))}</span></span><span class="cal-chip-meta">${escapeHtml([fmtDuration(a.duration), fmtDist(a.distance, a.sport)].filter(x => x !== '—').join(' · '))}</span></span>
        <span class="cal-chip__right"><b>${escapeHtml(a.tss || 0)}</b><small>Unplanned</small></span></button>`).join('');
    html += `<div class="cal-row${key === localDateKey(today) ? ' is-today' : ''}" ${calDropAttrs(key)}>
      <div class="cal-row__day"><span>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span><b>${d.getDate()}</b></div>
      <div class="cal-row__items">${rows || '<div class="cal-row__empty">Nothing planned</div>'}</div></div>`;
  }
  return html + '</div><p class="cal-hint">Tap a session to tick it or move it · drag to another day on desktop</p>';
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
  const id = escapeHtml(s.id);
  const done = !!(isSessionTicked(s) || m);
  const strip = [];
  if (s.durationMin) strip.push(['Duration', escapeHtml(fmtMinutes(s.durationMin))]);
  if (s.hrTarget) strip.push([/^[≤<]/.test(s.hrTarget) ? 'HR cap' : 'Heart rate', escapeHtml(s.hrTarget)]);
  if (s.powerTarget) strip.push(['Power', escapeHtml(s.powerTarget)]);
  if (s.tss) strip.push(['TSS', `<span class="tss">${escapeHtml(s.tss)}${m ? ' → ' + escapeHtml(m.tss) : ''}</span>`]);
  const main = s.sport === 'rest' ? ''
    : m ? `<span class="btn btn--secondary btn--lg" style="cursor:default;color:var(--color-ok)">✓ Done · ${escapeHtml(m.tss)} TSS</span><button class="btn btn--secondary btn--lg" data-id="${escapeHtml(m.id || '')}" onclick="document.getElementById('sessionDialog').close(); openActivityDetail(this.dataset.id)">Open activity</button>`
    : `<button class="btn ${done ? 'btn--secondary' : 'btn--primary'} btn--lg" data-session-id="${id}" aria-pressed="${done}" onclick="toggleSessionComplete(this.dataset.sessionId); openSessionDialog(this.dataset.sessionId); if (typeof renderCalendar === 'function') renderCalendar();"${done ? ' style="color:var(--color-ok)"' : ''}>${done ? '✓ Done' : 'Mark done'}</button>`;
  document.getElementById('sessionDialogBody').innerHTML = `
    <div class="sheet__head" style="align-items:flex-start">
      <div style="min-width:0">
        <div class="plan-session-caption">${sportDot(s.sport)}${escapeHtml(sportLabel(s.sport))} · W${escapeHtml(String(week.week).padStart(2, '0'))}${date ? ' · ' + escapeHtml(date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })) : ''}</div>
        <h2 class="session-card__title" style="margin-top:4px">${escapeHtml(s.name)}</h2>
      </div>
      <button class="icon-btn" onclick="document.getElementById('sessionDialog').close()" aria-label="Close">✕</button>
    </div>
    <div class="sheet__scroll">
    ${s.description ? `<p class="plan-session-desc">${escapeHtml(s.description)}</p>` : ''}
    ${strip.length ? `<div class="target-strip">${strip.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    ${main ? `<div class="session-dialog-actions">${main}</div>` : ''}
    ${sessionDetailsHtml(s, { summary: false, collapsible: false })}
    <div class="session-move">
      <label><span class="field-label">Move to</span><input type="date" class="input" id="sessionMoveDate" value="${date ? localDateKey(date) : ''}"></label>
      <button class="btn btn--secondary" data-session-id="${id}" onclick="moveSession(this.dataset.sessionId, document.getElementById('sessionMoveDate').value); document.getElementById('sessionDialog').close();">Move</button>
      ${planOverrides[s.id] && original ? `<button class="btn btn--secondary" data-session-id="${id}" data-date="${localDateKey(original)}" onclick="moveSession(this.dataset.sessionId, this.dataset.date); document.getElementById('sessionDialog').close();">Back to ${escapeHtml(original.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }))}</button>` : ''}
    </div>
    </div>`;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('.sheet__scroll').scrollTop = 0;
}
