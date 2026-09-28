// ══════════════════════════════════════════════
// Training Plan Import (parsing + validation + normalisation)
// ══════════════════════════════════════════════
// normalizePlan() turns an imported plan (text or object) into the shape the app renders.
// It never fails silently: it returns { plan, errors, warnings, summary }. When `errors` is
// non-empty the plan must not be used. The same function runs on plans loaded from Firestore,
// so older saved plans get the same defaults (ids, dates, recomputed TSS).
// The accepted schema is documented in CLAUDE.md ("Training plan import schema").

const PLAN_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const PLAN_DAYS_FR = { lundi: 'monday', mardi: 'tuesday', mercredi: 'wednesday', jeudi: 'thursday', vendredi: 'friday', samedi: 'saturday', dimanche: 'sunday' };
const PLAN_SPORTS = ['bike', 'run', 'swim', 'strength', 'strength+swim', 'rest', 'race'];
// English and French month names/abbreviations → month index
const PLAN_MONTHS = {
  jan: 0, janv: 0, janvier: 0, january: 0, feb: 1, fev: 1, 'fév': 1, fevr: 1, 'févr': 1, 'février': 1, february: 1,
  mar: 2, mars: 2, march: 2, apr: 3, avr: 3, avril: 3, april: 3, may: 4, mai: 4, jun: 5, juin: 5, june: 5,
  jul: 6, juil: 6, juillet: 6, july: 6, aug: 7, 'aoû': 7, aout: 7, 'août': 7, august: 7, sep: 8, sept: 8, septembre: 8, september: 8,
  oct: 9, octobre: 9, october: 9, nov: 10, novembre: 10, november: 10, dec: 11, 'déc': 11, decembre: 11, 'décembre': 11, december: 11,
};

function isoDateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
function monthIndex(word) {
  const w = String(word || '').toLowerCase().replace(/\.$/, '');
  return w in PLAN_MONTHS ? PLAN_MONTHS[w] : -1;
}

// Year and month of the race, from "2026-11-15" or "First weekend of May 2026"
function planRaceInfo(p) {
  const text = String(p.raceDate ?? p.race_date ?? '');
  const iso = parseIsoDate(text);
  if (iso) return { date: iso, year: iso.getFullYear(), month: iso.getMonth() };
  const y = text.match(/(20\d{2})/);
  const mw = text.toLowerCase().match(/[a-zéû]+/g) || [];
  const month = mw.map(monthIndex).find(i => i >= 0);
  const gen = parseIsoDate(p.generated);
  return { date: null, year: y ? +y[1] : gen ? gen.getFullYear() : new Date().getFullYear(), month: month ?? null };
}

// Start date of a week from its "dates" text: "Feb 23 – Mar 1", "7 – 13 sept.", "28 sept. – 4 oct."
function parseWeekDatesStart(text, race) {
  const first = String(text || '').split(/[–—-]/)[0].trim();
  let day, month;
  let m = first.match(/^([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2})$/);              // "Feb 23"
  if (m) { month = monthIndex(m[1]); day = +m[2]; }
  else if ((m = first.match(/^(\d{1,2})(?:\s+([A-Za-zÀ-ÿ]+)\.?)?$/))) { // "7" or "28 sept."
    day = +m[1];
    // Month may only appear after the end date: "7 – 13 sept."
    month = monthIndex(m[2] || (String(text).match(/([A-Za-zÀ-ÿ]+)\.?\s*$/) || [])[1]);
  }
  if (!(day >= 1 && day <= 31) || month < 0 || month === undefined) return null;
  // Plans end at (or just after) the race: months more than 2 after the race month are the previous year
  const year = race.month !== null && month - race.month > 2 ? race.year - 1 : race.year;
  const d = new Date(year, month, day);
  return d.getDate() === day ? d : null;
}

function normalizePlan(input) {
  const errors = [], warnings = [];
  const fail = msg => ({ plan: null, errors: [msg], warnings, summary: '' });

  let raw = input;
  if (typeof input === 'string') {
    try { raw = JSON.parse(input.replace(/^﻿/, '')); }
    catch (e) {
      // Browsers disagree on whether they report a position, so also look for the most common
      // hand-written mistakes (doubled or trailing commas) and point at their line
      let at = /position (\d+)/.exec(e.message)?.[1];
      let hint = '';
      const comma = /,(\s*)(?=[,\]}])/.exec(input);
      if (at == null && comma) { at = comma.index; hint = /,\s*,/.test(input.slice(comma.index, comma.index + comma[0].length + 1)) ? ' — doubled comma' : ' — trailing comma before a closing bracket'; }
      let where = '';
      if (at != null) { const before = input.slice(0, +at).split('\n'); where = ` (line ${before.length}, column ${before[before.length - 1].length + 1}${hint})`; }
      return fail(`Invalid JSON${where}: ${e.message}`);
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('The file must contain a JSON object with a "weeks" array.');
  // Accept the plan at the root or wrapped in {"trainingPlan": {...}}
  if (!Array.isArray(raw.weeks) && raw.trainingPlan && typeof raw.trainingPlan === 'object') raw = raw.trainingPlan;
  if (!Array.isArray(raw.weeks)) return fail('No "weeks" array found (expected at the root, or inside "trainingPlan").');
  if (!raw.weeks.length) return fail('The "weeks" array is empty.');

  const race = planRaceInfo(raw);
  const planStart = parseIsoDate(raw.startDate);
  const usedIds = new Set();
  let undatedWeeks = 0;

  const weeks = raw.weeks.map((w, wi) => {
    const label = `Week ${w && w.week != null ? w.week : wi + 1}`;
    if (!w || typeof w !== 'object' || Array.isArray(w)) { errors.push(`${label}: must be an object.`); return null; }
    if (!Array.isArray(w.sessions)) { errors.push(`${label}: missing "sessions" array.`); return null; }
    const weekNum = Number.isFinite(+w.week) && w.week !== null && w.week !== '' ? +w.week : wi + 1;

    // Week start: explicit startDate, then the "dates" text, then plan startDate, then count back from the race
    let start = parseIsoDate(w.startDate) || parseWeekDatesStart(w.dates, race);
    if (!start && planStart) start = new Date(planStart.getFullYear(), planStart.getMonth(), planStart.getDate() + wi * 7);
    if (!start && race.date) {
      const raceMonday = new Date(race.date.getFullYear(), race.date.getMonth(), race.date.getDate() - ((race.date.getDay() + 6) % 7));
      start = new Date(raceMonday.getFullYear(), raceMonday.getMonth(), raceMonday.getDate() - (raw.weeks.length - 1 - wi) * 7);
    }
    if (!start) undatedWeeks++;

    const sessions = w.sessions.map((s, si) => {
      const where = `${label}, session ${si + 1}${s && s.name ? ` ("${String(s.name).slice(0, 40)}")` : ''}`;
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(`${where}: must be an object.`); return null; }
      const dayRaw = String(s.day ?? '').trim().toLowerCase();
      const day = PLAN_DAYS.includes(dayRaw) ? dayRaw : PLAN_DAYS_FR[dayRaw];
      if (!day) { errors.push(`${where}: ${s.day == null ? 'missing "day"' : `unknown day "${s.day}"`} (use Monday…Sunday).`); return null; }
      const sport = String(s.sport ?? '').trim().toLowerCase();
      if (!sport) { errors.push(`${where}: missing "sport".`); return null; }
      if (!PLAN_SPORTS.includes(sport)) warnings.push(`${where}: unknown sport "${s.sport}" (shown as-is, not matched to activities).`);
      let tss = s.tss == null || s.tss === '' ? 0 : Number(s.tss);
      if (!Number.isFinite(tss) || tss < 0) { warnings.push(`${where}: "tss" is not a number, using 0.`); tss = 0; }

      // Stable id: keep the file's id, otherwise derive one from week + position + day
      let id = typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `w${weekNum}-${si + 1}-${day.slice(0, 3)}`;
      while (usedIds.has(id)) id += '-dup';
      usedIds.add(id);

      const dayName = day[0].toUpperCase() + day.slice(1);
      return {
        ...s,
        id, day: dayName, sport,
        name: s.name != null && String(s.name).trim() ? String(s.name) : `${dayName} ${sport}`,
        description: s.description == null ? '' : String(s.description),
        tss: Math.round(tss),
        completed: s.completed === true,
        zwo_file: s.zwo_file ?? s.zwoFile ?? null,
      };
    }).filter(Boolean);

    const weekTss = sessions.reduce((sum, s) => sum + s.tss, 0);
    return {
      ...w,
      week: weekNum,
      phase: w.phase == null ? '' : String(w.phase),
      dates: w.dates == null ? '' : String(w.dates),
      startDate: start ? isoDateKey(start) : null,
      tss: weekTss,                   // recomputed from sessions, not trusted from the file
      sessionCount: sessions.length,  // idem
      sessions,
    };
  });

  if (errors.length) return { plan: null, errors, warnings, summary: '' };
  if (undatedWeeks) warnings.push(`${undatedWeeks} week(s) have no readable dates: add "startDate": "YYYY-MM-DD" to enable this-week highlighting and plan vs actual.`);

  const plan = {
    ...raw,
    weeks,
    race: raw.race == null ? '' : String(raw.race),
    raceDate: raw.raceDate ?? raw.race_date ?? null,
    generated: raw.generated ?? null,
    ftpWatts: raw.ftpWatts ?? raw.calibration?.ftp_watts ?? null,
    totalWeeks: weeks.length,
  };
  const sessionTotal = weeks.reduce((n, w) => n + w.sessions.length, 0);
  return { plan, errors, warnings, summary: `${weeks.length} weeks, ${sessionTotal} sessions imported` };
}
