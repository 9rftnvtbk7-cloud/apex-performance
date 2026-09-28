// Behavioural tests for app logic (TSS, Strava sync, planner, deletes), run against the real
// browser scripts in public/js/ inside a stubbed browser context. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../public/js/', import.meta.url).pathname;

function makeEnv() {
  const els = {};
  const el = id => (els[id] ??= { id, value: '', style: {}, textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {} },
    getContext: () => ({}), appendChild() {}, querySelector: () => null, scrollIntoView() {},
    append(...c) { (this.children ??= []).push(...c); }, replaceChildren() { this.children = []; }, setAttribute() {}, hidden: true });
  const toasts = [];
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el('tmp' + Math.random()), body: { appendChild() {} } },
    window: { location: { origin: 'https://x', search: '' } },
    setTimeout: (fn) => 0, requestAnimationFrame() {}, confirm: () => true,
    Chart: function () { this.destroy = () => {}; this.update = () => {}; },
    sessionStorage: { getItem() {}, setItem() {}, removeItem() {} },
    crypto: globalThis.crypto, URLSearchParams, Date, Math, JSON, Set, Map, Array, Object, String, Number, isNaN, parseInt, Promise,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // Firebase globals used at load time by auth/database/strava
  vm.runInContext('var auth = { onAuthStateChanged(){ return () => {}; } }; var db = {}; var firebase = { firestore: { FieldValue: { serverTimestamp(){} }, Timestamp: { fromDate: d => d } } };', ctx);
  for (const f of ['auth.js', 'database.js', 'strava.js', 'plan-import.js', 'app.js']) vm.runInContext(fs.readFileSync(ROOT + f, 'utf8'), ctx, { filename: f });
  // Capture toasts
  vm.runInContext('showToast = (m) => __toasts.push(m);', Object.assign(ctx, { __toasts: toasts }));
  el('inputFtp').value = '250'; el('inputLthr').value = '165'; el('inputPace').value = '4:30'; el('inputSwimPace').value = '1:40';
  return { ctx, el, toasts, run: code => vm.runInContext(code, ctx) };
}

test('TSS: cycling uses power; running power ignored; swim uses CSS', () => {
  const { run } = makeEnv();
  const ride = run(`computeTSS({ sport: 'cycling', duration: 3600, np: 250, avgPower: 230 })`);
  assert.deepEqual({ ...ride }, { tss: 100, intensityFactor: 1 });
  // A run with power but no speed must NOT be scored against cycling FTP; falls back to HR
  const run1 = run(`computeTSS({ sport: 'running', duration: 3600, np: 300, avgPower: 290, avgSpeed: 0, avgHr: 165 })`);
  assert.equal(run1.tss, 100);
  // Swim at exactly CSS (1:40/100m = 1 m/s) for 1h = 100 sTSS
  const swim = run(`computeTSS({ sport: 'swimming', duration: 3600, avgSpeed: 1.0 })`);
  assert.deepEqual({ ...swim }, { tss: 100, intensityFactor: 1 });
  // Faster than CSS scales cubically
  assert.equal(run(`computeTSS({ sport: 'swimming', duration: 3600, avgSpeed: 1.1 })`).tss, 133);
});

test('Strava mapping: sport_type preferred, estimated watts dropped', () => {
  const { run } = makeEnv();
  const est = run(`stravaToActivity({ id: 1, start_date: '2026-09-01T06:00:00Z', type: 'Ride', sport_type: 'VirtualRide', average_watts: 180, weighted_average_watts: 190, device_watts: false, moving_time: 3600 })`);
  assert.equal(est.sport, 'cycling');
  assert.equal(est.avgPower, null);
  assert.equal(est.np, null);
  const meter = run(`stravaToActivity({ id: 2, start_date: '2026-09-01T06:00:00Z', type: 'Run', sport_type: 'TrailRun', average_watts: 250, device_watts: true, moving_time: 3600 })`);
  assert.equal(meter.sport, 'running');
  assert.equal(meter.avgPower, 250);
});

async function runSync(env, existing, pages) {
  const { ctx, run } = env;
  const calls = [];
  ctx.fetch = async (url) => {
    calls.push(url);
    const page = +new URL(url).searchParams.get('page');
    const body = pages[page - 1] || [];
    return { ok: true, status: 200, json: async () => body };
  };
  ctx.__existing = existing;
  run(`allActivities = __existing; stravaTokens = { access_token: 'a', expires_at: 9e12 }; currentUser = { uid: 'u' };
       var __saved = []; saveActivitiesBatch = async (acts) => { acts.forEach((a, i) => { a.id = 'new' + __saved.length; __saved.push(a); }); };
       refreshDashboard = () => {};`);
  await run('syncStravaActivities()');
  return { calls, saved: run('__saved') };
}

const sa = (id, iso, extra = {}) => ({ id, start_date: iso, type: 'Ride', sport_type: 'Ride', moving_time: 3600, ...extra });

test('Sync: first sync fetches everything (after=0), 200 per page, no 11-page cap', async () => {
  const env = makeEnv();
  const pages = Array.from({ length: 13 }, (_, p) => Array.from({ length: p < 12 ? 200 : 5 }, (_, i) => sa(p * 1000 + i, new Date(Date.UTC(2020, 0, 1) + (p * 200 + i) * 86400000).toISOString())));
  const { calls, saved } = await runSync(env, [], pages);
  assert.equal(calls.length, 13);
  assert.match(calls[0], /per_page=200&page=1&after=0$/);
  assert.equal(saved.length, 12 * 200 + 5);
});

test('Sync: resumes from newest Strava activity minus 7 days, skips known IDs, ignores FIT uploads for the cursor', async () => {
  const env = makeEnv();
  const newestStrava = new Date('2026-09-20T07:00:00Z');
  const existing = [
    { id: 'a', fileName: 'strava_111', sport: 'cycling', startDate: newestStrava },
    { id: 'b', fileName: 'morning.fit', sport: 'running', startDate: new Date('2026-09-27T07:00:00Z') }, // newer FIT must not move the cursor
  ];
  const pages = [[
    sa(111, '2026-09-20T07:00:00Z'),                     // already imported → skipped by ID
    sa(222, '2026-09-18T07:00:00Z'),                     // uploaded late, older start → now imported
    sa(333, '2026-09-27T07:00:30Z', { type: 'Run', sport_type: 'Run' }), // same as the FIT run → skipped
  ]];
  const { calls, saved } = await runSync(env, existing, pages);
  const after = +new URL(calls[0]).searchParams.get('after');
  assert.equal(after, Math.floor(newestStrava.getTime() / 1000) - 7 * 86400);
  assert.deepEqual([...saved.map(a => a.fileName)], ['strava_222']);
});

test('Sync: stops at 50 pages and says so', async () => {
  const env = makeEnv();
  const pages = Array.from({ length: 60 }, (_, p) => Array.from({ length: 200 }, (_, i) => sa(p * 1000 + i, '2021-01-01T00:00:00Z')));
  const { calls } = await runSync(env, [], pages);
  assert.equal(calls.length, 50);
  assert.ok(env.toasts.some(t => /Sync Strava again/.test(t)));
});

test('Planner restores saved TSS by week date, not by position (incl. DST-shifted saves)', () => {
  const { run } = makeEnv();
  run(`renderPlannerGrid = () => {}; updatePlannerForecast = () => {}; trainingPlan = null; plannerInited = false;`);
  // Build this planner's week starts, then pretend the save was made 2 weeks ago (so positions differ)
  run(`initPlanner(); var __weeks = plannerData.map(p => p.weekStart);`);
  const w = run('__weeks.map(d => d.getTime())');
  const saved = [
    { weekStart: new Date(w[0] - 14 * 86400000).toISOString(), tss: 999 },         // past week → dropped
    { weekStart: new Date(w[0]).toISOString(), tss: 300 },                         // week 1
    { weekStart: new Date(w[2] - 3600000).toISOString(), tss: 450 },               // week 3, saved an hour early (old DST bug)
  ];
  run(`savedPlannerWeeks = ${JSON.stringify(saved)}; plannerInited = false; initPlanner();`);
  const tss = run('plannerData.map(p => p.tss)');
  assert.equal(tss[0], 300);
  assert.equal(tss[1], 0);
  assert.equal(tss[2], 450);
  assert.ok(!tss.includes(999));
});

test('Delete: nothing removed from screen when Firestore delete fails', async () => {
  const { run, toasts } = makeEnv();
  run(`currentUser = { uid: 'u' }; allActivities = [{ id: 'x1' }, { id: 'x2' }]; selectedActivityIds = new Set(['x1']);
       deleteActivities = async () => false; refreshDashboard = () => {}; updateSelectionUI = () => {};`);
  await run('deleteSelectedActivities()');
  assert.equal(run('allActivities.length'), 2);
  assert.ok(toasts.some(t => /Delete failed/.test(t)));
  run(`deleteActivities = async () => true;`);
  await run('deleteSelectedActivities()');
  assert.deepEqual([...run('allActivities.map(a => a.id)')], ['x2']);
});

test('deleteActivities splits into batches under the 500-write limit', async () => {
  const { run, ctx } = makeEnv();
  ctx.__commits = [];
  run(`currentUser = { uid: 'u' };
       db.collection = () => ({ doc: () => ({ collection: () => ({ doc: id => id }) }) });
       db.batch = () => { const ops = []; return { delete: r => ops.push(r), commit: async () => { __commits.push(ops.length); } }; };`);
  const ids = JSON.stringify(Array.from({ length: 1234 }, (_, i) => 'id' + i));
  assert.equal(await run(`deleteActivities(${ids})`), true);
  assert.deepEqual(ctx.__commits, [450, 450, 334]);
});

// ── Plan vs actual, coaching ──
const PLAN = {
  race_date: 'First weekend of May 2026',
  weeks: [
    { week: 1, dates: 'Feb 23 – Mar 1', tss: 300, sessions: [
      { id: 'w1-tue-bike', day: 'Tuesday', sport: 'bike', tss: 52 },
      { id: 'w1-wed-ss', day: 'Wednesday', sport: 'strength+swim', tss: 38 },
      { id: 'w1-thu-run', day: 'Thursday', sport: 'run', tss: 35 },
      { id: 'w1-sun-rest', day: 'Sunday', sport: 'rest', tss: 0 },
    ] },
  ],
};

test('Plan dates: year from race_date, Monday start, session days', () => {
  const { run } = makeEnv();
  run(`var __plan = ${JSON.stringify(PLAN)};`);
  assert.equal(run(`localDateKey(planWeekStart(__plan.weeks[0], __plan))`), '2026-02-23');
  assert.equal(run(`localDateKey(planSessionDate(planWeekStart(__plan.weeks[0], __plan), 'Thursday'))`), '2026-02-26');
  // An autumn week of a spring race belongs to the previous year
  assert.equal(run(`localDateKey(planWeekStart({ dates: 'Nov 3 – Nov 9' }, __plan))`), '2025-11-03');
  assert.equal(run(`planWeekStart({ dates: 'garbage' }, __plan)`), null);
  assert.equal(run(`isWeekCurrent(__plan.weeks[0], __plan, new Date(2026, 1, 26, 15))`), true);
  assert.equal(run(`isWeekCurrent(__plan.weeks[0], __plan, new Date(2026, 2, 2, 8))`), false);
});

test('Plan vs actual: matches by day and sport, one activity per session, walks are not runs', () => {
  const { run } = makeEnv();
  run(`var __plan = ${JSON.stringify(PLAN)};
       allActivities = [
         { id: 'ride', sport: 'cycling', startDate: new Date(2026, 1, 24, 7), tss: 60 },
         { id: 'swim', sport: 'swimming', startDate: new Date(2026, 1, 25, 12), tss: 30 },
         { id: 'walk', sport: 'walking', startDate: new Date(2026, 1, 26, 18), tss: 10 },
         { id: 'ride2', sport: 'cycling', startDate: new Date(2026, 1, 27, 7), tss: 40 },
       ];`);
  const m = run(`var __m = matchPlanToActivities(__plan); ({ bike: __m.get('w1-tue-bike')?.id, ss: __m.get('w1-wed-ss')?.id, run: __m.get('w1-thu-run')?.id ?? null, size: __m.size })`);
  assert.deepEqual({ ...m }, { bike: 'ride', ss: 'swim', run: null, size: 2 });
});

test('Weekly goal comes from the plan week, then the planner', () => {
  const { run } = makeEnv();
  run(`trainingPlan = ${JSON.stringify(PLAN)}; plannerData = [];
       savedPlannerWeeks = [{ weekStart: new Date(2026, 2, 2).toISOString(), tss: 420 }];`);
  assert.deepEqual({ ...run(`plannedTssForWeek(new Date(2026, 1, 23))`) }, { tss: 300, source: 'plan W1' });
  assert.deepEqual({ ...run(`plannedTssForWeek(new Date(2026, 2, 2))`) }, { tss: 420, source: 'planner' });
  assert.equal(run(`plannedTssForWeek(new Date(2026, 2, 9))`), null);
});

test('TSB zones and ramp rate labels', () => {
  const { run } = makeEnv();
  assert.match(run(`tsbZone(30).label`), /Transition/);
  assert.match(run(`tsbZone(10).label`), /Fresh/);
  assert.match(run(`tsbZone(0).label`), /Neutral/);
  assert.match(run(`tsbZone(-20).label`), /Optimal/);
  assert.match(run(`tsbZone(-35).label`), /High risk/);
  assert.equal(run(`rampInfo(10).label`), 'too fast');
  assert.equal(run(`rampInfo(6).label`), 'aggressive build');
  assert.equal(run(`rampInfo(3).label`), 'steady build');
  assert.equal(run(`rampInfo(-2).label`), 'easing off');
});


// ── Plan import (block A) ──
const FIX = new URL('../test-fixtures/', import.meta.url).pathname;
const fixture = name => fs.readFileSync(FIX + name, 'utf8');

function importText(run, ctx, text) {
  ctx.__text = text;
  return run('normalizePlan(__text)');
}

test('Import: short, long and the old v5 plan all normalise without errors', () => {
  const { run, ctx } = makeEnv();
  for (const [file, weeks, sessions] of [['plan_short.json', 10, 70], ['plan_long.json', 10, 70]]) {
    const r = importText(run, ctx, fixture(file));
    assert.deepEqual([...r.errors], [], file);
    assert.equal(r.summary, `${weeks} weeks, ${sessions} sessions imported`);
  }
  const v5 = importText(run, ctx, fs.readFileSync(new URL('../training-plan/training_plan_v5.json', import.meta.url), 'utf8'));
  assert.deepEqual([...v5.errors], []);
  assert.equal(v5.plan.weeks[0].startDate, '2026-02-23');
  // Existing ids are kept, so ticks saved under the old ids still apply
  assert.equal(v5.plan.weeks[0].sessions[0].id, 'W01_Tue_Bike_Z2_Endurance');
});

test('Import: accepts the {"trainingPlan": …} envelope (the original bug)', () => {
  const { run, ctx } = makeEnv();
  const r = importText(run, ctx, JSON.stringify({ trainingPlan: JSON.parse(fixture('plan_long.json')) }));
  assert.deepEqual([...r.errors], []);
  assert.equal(r.plan.weeks.length, 10);
});

test('Import: French dates, Monday sessions, recomputed TSS, unique ids, optional fields', () => {
  const { run, ctx } = makeEnv();
  const raw = JSON.parse(fixture('plan_short.json'));
  delete raw.ftpWatts; delete raw.generated;
  raw.weeks.forEach(w => w.sessions.forEach(s => { delete s.zwoFile; delete s.completed; }));
  const { plan, errors } = importText(run, ctx, JSON.stringify(raw));
  assert.deepEqual([...errors], []);
  assert.equal(plan.weeks[0].startDate, '2026-09-07');      // "7 – 13 sept."
  assert.equal(plan.weeks[3].startDate, '2026-09-28');      // "28 sept. – 4 oct."
  assert.equal(plan.weeks[9].startDate, '2026-11-09');
  assert.equal(plan.weeks[0].sessions[0].day, 'Monday');
  const w1 = plan.weeks[0];
  assert.equal(w1.tss, w1.sessions.reduce((a, s) => a + s.tss, 0)); // file said +7
  assert.equal(w1.sessionCount, 7);                                   // file said 6
  const ids = plan.weeks.flatMap(w => w.sessions.map(s => s.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], 'w1-1-mon');
  assert.equal(w1.sessions[1].zwo_file, null);
  assert.equal(w1.sessions[1].completed, false);
  assert.equal(plan.ftpWatts, null);
});

test('Import: clear errors for invalid JSON and a week without sessions', () => {
  const { run, ctx } = makeEnv();
  const bad = importText(run, ctx, fixture('plan_broken_json.json'));
  assert.equal(bad.plan, null);
  assert.match(bad.errors[0], /^Invalid JSON \(line 1, column \d+ — doubled comma\)/);
  const week = importText(run, ctx, fixture('plan_broken_week.json'));
  assert.deepEqual([...week.errors], ['Week 3: missing "sessions" array.']);
  const day = importText(run, ctx, JSON.stringify({ weeks: [{ week: 1, sessions: [{ day: 'Mardii', sport: 'run', name: 'Easy' }] }] }));
  assert.match(day.errors[0], /^Week 1, session 1 \("Easy"\): unknown day "Mardii"/);
  assert.match(importText(run, ctx, '{"plan": []}').errors[0], /No "weeks" array/);
});

test('Import: failed import keeps the current plan and reports in the Plan tab', async () => {
  const { run, ctx, el, toasts } = makeEnv();
  run(`trainingPlan = { weeks: [] }; var __before = trainingPlan; renderTrainingPlan = () => {};`);
  ctx.__text = fixture('plan_broken_week.json');
  assert.equal(await run(`applyImportedPlan(__text, 'broken.json')`), false);
  assert.equal(run('trainingPlan === __before'), true);
  const status = el('planImportStatus');
  assert.equal(status.hidden, false);
  assert.match(status.className, /--error/);
  assert.equal(status.children[0].textContent, 'Import failed: broken.json was not imported');
  assert.ok(toasts.some(t => /Plan import failed/.test(t)));
});

test('Import: success applies the plan, saves it and shows the summary', async () => {
  const { run, ctx, el } = makeEnv();
  run(`renderTrainingPlan = () => {}; raceDates = []; renderRaceDateInputs = () => {}; saveRaceDates = () => {};
       var __savedPlan = null; saveTrainingPlan = async p => { __savedPlan = p; return true; };`);
  ctx.__text = fixture('plan_long.json');
  assert.equal(await run(`applyImportedPlan(__text, 'plan_long.json')`), true);
  assert.equal(run('trainingPlan.weeks.length'), 10);
  assert.equal(run('__savedPlan === trainingPlan'), true);
  assert.equal(el('planImportStatus').children[0].textContent, '✅ 10 weeks, 70 sessions imported');
  assert.equal(run('raceDates[0].date'), '2026-11-15');   // from ISO raceDate
});

test('Ticking: sessions without ids in the file can be ticked and unticked independently', () => {
  const { run, ctx } = makeEnv();
  ctx.__text = fixture('plan_short.json');
  run(`trainingPlan = normalizePlan(__text).plan; planCompletions = {}; renderTrainingPlan = () => {}; savePlanCompletions = () => {};`);
  run(`toggleSessionComplete('w1-2-tue')`);
  assert.equal(run(`isSessionTicked(trainingPlan.weeks[0].sessions[1])`), true);
  assert.equal(run(`isSessionTicked(trainingPlan.weeks[0].sessions[2])`), false);
  run(`toggleSessionComplete('w1-2-tue')`);
  assert.equal(run(`isSessionTicked(trainingPlan.weeks[0].sessions[1])`), false);
  // "completed": true in the file counts as done, and can be unticked
  run(`trainingPlan.weeks[0].sessions[2].completed = true`);
  assert.equal(run(`isSessionTicked(trainingPlan.weeks[0].sessions[2])`), true);
  run(`toggleSessionComplete('w1-3-wed')`);
  assert.equal(run(`isSessionTicked(trainingPlan.weeks[0].sessions[2])`), false);
});
