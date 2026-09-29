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
    append(...c) { (this.children ??= []).push(...c); }, replaceChildren() { this.children = []; }, setAttribute() {}, hidden: true,
    showModal() { this.open = true; }, close() { this.open = false; } });
  const toasts = [];
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => el('tmp' + Math.random()), body: { appendChild() {} } },
    window: { location: { origin: 'https://x', search: '' } },
    setTimeout: (fn) => 0, setInterval: () => 0, requestAnimationFrame() {}, confirm: () => true,
    Chart: function () { this.destroy = () => {}; this.update = () => {}; },
    sessionStorage: { getItem() {}, setItem() {}, removeItem() {} },
    crypto: globalThis.crypto, TextEncoder, URLSearchParams, Date, Math, JSON, Set, Map, Array, Object, String, Number, isNaN, parseInt, Promise,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // Firebase globals used at load time by auth/database/strava
  vm.runInContext('var auth = { onAuthStateChanged(){ return () => {}; } }; var db = {}; var firebase = { firestore: { FieldValue: { serverTimestamp(){} }, Timestamp: { fromDate: d => d } } };', ctx);
  for (const f of ['auth.js', 'database.js', 'strava.js', 'thresholds.js', 'metrics.js', 'activity-detail.js', 'insights.js', 'plan-import.js', 'app.js']) vm.runInContext(fs.readFileSync(ROOT + f, 'utf8'), ctx, { filename: f });
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
  // Only the activity-list requests (the background stream fetch starts after a sync)
  return { calls: calls.filter(u => u.includes('/athlete/activities')), saved: run('__saved') };
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

// ── Detailed session fields (block B) ──
test('Detail fields: kept when valid, dropped with a warning when not, absent → defaults', () => {
  const { run, ctx } = makeEnv();
  const r = importText(run, ctx, fixture('plan_detailed.json'));
  assert.deepEqual([...r.errors], []);
  assert.deepEqual([...r.warnings], []);
  const bike = r.plan.weeks[0].sessions.find(s => s.sport === 'bike');
  assert.equal(bike.durationMin, 50);
  assert.equal(bike.hrTarget, '≤160 bpm');
  assert.equal(bike.powerTarget, '170W (85% FTP)');
  assert.equal(bike.steps.length, 3);
  assert.deepEqual({ ...bike.steps[1] }, { label: '3×8min', duration: '8min', target: '170W', rest: '2min Z1' });
  assert.match(bike.details, /^## Échauffement/);
  // A plan without the new fields gets neutral defaults
  const plain = importText(run, ctx, fixture('plan_short.json')).plan.weeks[0].sessions[1];
  assert.deepEqual({ details: plain.details, durationMin: plain.durationMin, hrTarget: plain.hrTarget, powerTarget: plain.powerTarget, steps: [...plain.steps] },
    { details: null, durationMin: null, hrTarget: null, powerTarget: null, steps: [] });
  // Bad values → warnings, never errors
  const bad = importText(run, ctx, JSON.stringify({ weeks: [{ week: 1, sessions: [{ day: 'Monday', sport: 'run', name: 'X',
    details: { a: 1 }, durationMin: 'long', hrTarget: 150, steps: [{ label: 'A', duration: 10 }, 'oops'] }] }] }));
  assert.deepEqual([...bad.errors], []);
  assert.equal(bad.warnings.filter(w => /session 1/.test(w)).length, 3); // + one "no readable dates" warning
  const s = bad.plan.weeks[0].sessions[0];
  assert.equal(s.details, null);
  assert.equal(s.durationMin, null);
  assert.equal(s.hrTarget, '150');
  assert.deepEqual({ ...s.steps[0] }, { label: 'A', duration: '10', target: null, rest: null });
  assert.equal(s.steps.length, 1);
});

// ── Display (block C) ──
test('Markdown is rendered safely: markup only from known syntax, raw HTML shown as text', () => {
  const { run, ctx } = makeEnv();
  ctx.__md = '## Échauffement\n- 10min **Z1→Z2** (FC ≤ 135)\n- `<Ne pas>` sauter\n\n1. 3×8min @ 170W\n2. *récup* 2min\n\n> fatigue > 7/10 : 40min Z1\n<img src=x onerror="alert(1)"> & <script>alert(2)</script>';
  const html = run('renderMarkdownSafe(__md)');
  assert.ok(!/<img|<script/i.test(html), html);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &lt;script&gt;/);
  assert.match(html, /<div class="plan-md-h">Échauffement<\/div>/);
  assert.match(html, /<ul><li>10min <strong>Z1→Z2<\/strong> \(FC ≤ 135\)<\/li><li><code>&lt;Ne pas&gt;<\/code> sauter<\/li><\/ul>/);
  assert.match(html, /<ol><li>3×8min @ 170W<\/li><li><em>récup<\/em> 2min<\/li><\/ol>/);
  assert.match(html, /<blockquote>fatigue &gt; 7\/10 : 40min Z1<\/blockquote>/);
});

test('Plan tab renders name, version, meta, details and steps; plain plans render as before', () => {
  const { run, ctx, el } = makeEnv();
  run(`zwoFiles = {}; planCompletions = {}; allActivities = [];`);
  ctx.__text = fixture('plan_detailed.json');
  run(`trainingPlan = normalizePlan(__text).plan; renderTrainingPlan();`);
  const header = el('planHeader').innerHTML, weeks = el('planWeeks').innerHTML;
  assert.match(header, /Saint-Nolff Trail 30K — 10-week plan <span class="plan-version">v2\.1<\/span>/);
  assert.match(header, /🏁 15 Nov 2026/);
  assert.match(header, /10 weeks · 70 sessions/);
  assert.match(weeks, /⏱ 50 min/);
  assert.match(weeks, /❤️ ≤160 bpm/);
  assert.match(weeks, /⚡ 170W \(85% FTP\)/);
  assert.match(weeks, /<details class="plan-session-details"><summary>Details<\/summary>/);
  assert.match(weeks, /<td>3×8min<\/td><td>8min<\/td><td>170W<\/td><td>2min Z1<\/td>/);
  // Each session has its own tickable id
  assert.match(weeks, /data-session-id="w1-2-tue"/);
  // Long descriptions are clamped on the card and shown in full in the details
  ctx.__text = fixture('plan_long.json');
  run(`trainingPlan = normalizePlan(__text).plan; renderTrainingPlan();`);
  const long = el('planWeeks').innerHTML;
  assert.match(long, /class="plan-session-desc is-clamped"/);
  assert.match(long, /<p class="plan-md-pre">50min au total/);
  assert.ok(!/<Ne pas>/.test(long)); // escaped
  // Old v5 plan: no details element, header keeps its version
  ctx.__text = fs.readFileSync(new URL('../training-plan/training_plan_v5.json', import.meta.url), 'utf8');
  run(`trainingPlan = normalizePlan(__text).plan; renderTrainingPlan();`);
  assert.ok(!/plan-session-details/.test(el('planWeeks').innerHTML));
  assert.match(el('planHeader').innerHTML, /<span class="plan-version">v5/);
});

// ── Storage (block D) ──
// In-memory Firestore stand-in for the plan collection
function fakePlanDb(run, ctx) {
  ctx.__store = new Map();
  run(`currentUser = { uid: 'u' };
    db.collection = () => ({ doc: () => ({ collection: () => ({ doc: id => ({
      id, get: async () => ({ exists: __store.has(id), data: () => __store.get(id) }) }) }) }) });
    db.batch = () => { const ops = []; return {
      set: (ref, data) => ops.push(['set', ref.id, data]), delete: ref => ops.push(['del', ref.id]),
      commit: async () => { for (const [op, id, data] of ops) op === 'set' ? __store.set(id, data) : __store.delete(id); } }; };`);
  return ctx.__store;
}

test('Storage: normal plans stay in one document; the long fixture is far below the limit', async () => {
  const { run, ctx } = makeEnv();
  const store = fakePlanDb(run, ctx);
  ctx.__text = fixture('plan_long.json');
  assert.equal(await run(`saveTrainingPlan(normalizePlan(__text).plan)`), true);
  assert.deepEqual([...store.keys()], ['current']);
  assert.ok(store.get('current').bytes < 100 * 1024, `long plan is ${store.get('current').bytes} bytes`);
  assert.equal((await run(`loadTrainingPlan()`)).weeks.length, 10);
});

test('Storage: a plan over 800 KB is split into parts and read back identically (emoji-safe)', async () => {
  const { run, ctx } = makeEnv();
  const store = fakePlanDb(run, ctx);
  // ~2.6 MB of details with emoji straddling every possible split point
  ctx.__text = fixture('plan_detailed.json');
  run(`var __big = normalizePlan(__text).plan;
       __big.weeks.forEach(w => w.sessions.forEach(s => { s.details = '💪é'.repeat(9000) + s.id; }));`);
  assert.equal(await run(`saveTrainingPlan(__big)`), true);
  const parts = store.get('current').parts;
  assert.ok(parts >= 2, `parts=${parts}`);
  for (let i = 0; i < parts; i++) assert.ok(Buffer.byteLength(store.get(`current_part_${i}`).data) <= 1024 * 1024);
  const back = await run(`loadTrainingPlan()`);
  assert.equal(JSON.stringify(back), run('JSON.stringify(__big)'));
  // Saving a small plan afterwards removes the leftover parts
  assert.equal(await run(`saveTrainingPlan(normalizePlan(__text).plan)`), true);
  assert.deepEqual([...store.keys()], ['current']);
});

test('Storage: a missing part is reported, not silently ignored', async () => {
  const { run, ctx } = makeEnv();
  const store = fakePlanDb(run, ctx);
  store.set('current', { parts: 2 });
  store.set('current_part_0', { data: '{"weeks":', index: 0 });
  await assert.rejects(run(`loadTrainingPlan()`), /part 2 of 2 is missing/);
});

// ── Overview: next 2 days ──
test('Next 2 days shows today and tomorrow from the plan, tickable, with rest days and done state', () => {
  const { run, ctx, el } = makeEnv();
  ctx.__text = fixture('plan_detailed.json');
  run(`planCompletions = { 'w4-2-tue': true }; allActivities = []; trainingPlan = normalizePlan(__text).plan;`);
  run(`renderUpcomingSessions(new Date(2026, 8, 28, 9))`); // Monday 28 Sep = week 4
  const html = el('upcomingDays').innerHTML;
  assert.equal(el('upcomingCard').style.display, 'block');
  assert.match(html, /<strong>Today<\/strong> · Mon 28 Sept?/);
  assert.match(html, /💪 W04 Mon – Renfo A/);
  assert.match(html, /data-session-id="w4-1-mon"/);
  assert.match(html, /<strong>Tomorrow<\/strong>/);
  assert.match(html, /upcoming-session is-done"><input type="checkbox" checked aria-label="Mark W04 Tue/);
  assert.match(html, /⚡ 170W \(85% FTP\)/);
  // Thursday: rest day has no checkbox; Sunday → Monday of a week after the plan: nothing planned
  run(`renderUpcomingSessions(new Date(2026, 9, 1, 9))`);
  assert.match(el('upcomingDays').innerHTML, /😴 W04 Thu – Repos/);
  run(`renderUpcomingSessions(new Date(2026, 10, 15, 9))`);
  assert.match(el('upcomingDays').innerHTML, /🏁 W10 Sun – Trail de Saint-Nolff 30km[\s\S]*Nothing planned/);
  // No plan → card hidden
  run(`trainingPlan = null; renderUpcomingSessions()`);
  assert.equal(el('upcomingCard').style.display, 'none');
});

// ── Threshold history ──
test('Thresholds: each activity is scored with the values valid on its date', () => {
  const { run } = makeEnv();
  run(`thresholdHistory = normalizeThresholdHistory([
         { from: '2000-01-01', ftp: 200, lthr: 160, pace: '5:00', swimPace: '2:00' },
         { from: '2026-06-01', ftp: 250, lthr: 165, pace: '4:30', swimPace: '1:45' }]);`);
  // 1h at 250W NP: IF 1.25 in May (FTP 200) → 156 TSS; IF 1.0 in June (FTP 250) → 100 TSS
  assert.equal(run(`computeTSS({ sport: 'cycling', duration: 3600, np: 250, startDate: new Date(2026, 4, 20) }).tss`), 156);
  assert.equal(run(`computeTSS({ sport: 'cycling', duration: 3600, np: 250, startDate: new Date(2026, 5, 1, 6) }).tss`), 100);
  // Before the first entry → first entry
  assert.equal(run(`thresholdsAt(new Date(1999, 0, 1)).ftp`), 200);
  assert.equal(run(`currentThresholds().ftp`), 250);
});

test('Thresholds: upsert replaces the same date, keeps order; bad stored values get defaults', () => {
  const { run } = makeEnv();
  run(`var __h = normalizeThresholdHistory([{ from: '2026-06-01', ftp: 250, lthr: 165, pace: '4:30', swimPace: '1:45' },
         { from: '2000-01-01', ftp: 200, lthr: 160, pace: 'fast', swimPace: '2:00' }, { from: 'bad', ftp: 1 }]);`);
  assert.deepEqual([...run(`__h.map(h => h.from)`)], ['2000-01-01', '2026-06-01']);
  assert.equal(run(`__h[0].pace`), '5:00');
  run(`__h = upsertThresholds(__h, { from: '2026-06-01', ftp: 260, lthr: 165, pace: '4:30', swimPace: '1:45' });
       __h = upsertThresholds(__h, { from: '2026-03-01', ftp: 230, lthr: 162, pace: '4:40', swimPace: '1:50' });`);
  assert.deepEqual([...run(`__h.map(h => h.from + ':' + h.ftp)`)], ['2000-01-01:200', '2026-03-01:230', '2026-06-01:260']);
});

test('Thresholds: saving from a date rescores only activities from that date', async () => {
  const { run, el } = makeEnv();
  run(`thresholdHistory = [{ from: '2000-01-01', ftp: 200, lthr: 165, pace: '5:00', swimPace: '2:00' }];
       allActivities = [
         { id: 'may', sport: 'cycling', duration: 3600, np: 200, startDate: new Date(2026, 4, 10), tss: 100, intensityFactor: 1 },
         { id: 'jul', sport: 'cycling', duration: 3600, np: 200, startDate: new Date(2026, 6, 10), tss: 100, intensityFactor: 1 }];
       var __saved = null; saveThresholdHistory = async h => { __saved = h; return true; };
       var __updated = []; updateActivitiesTss = a => { __updated = a.map(x => x.id); };
       refreshDashboard = () => {}; saveSettings = () => {};`);
  el('inputFtp').value = '250'; el('inputLthr').value = '165'; el('inputPace').value = '4:30'; el('inputSwimPace').value = '1:45';
  el('inputThresholdFrom').value = '2026-06-01';
  assert.equal(await run('saveThresholdsFromInputs()'), true);
  assert.equal(run('__saved.length'), 2);
  assert.equal(run(`allActivities[0].tss`), 100);   // May unchanged
  assert.equal(run(`allActivities[1].tss`), 64);    // July: 200W at FTP 250 → IF 0.8 → 64
  assert.deepEqual([...run('__updated')], ['jul']);
  // Invalid pace → rejected, nothing saved
  el('inputPace').value = 'fast';
  run('__saved = null');
  assert.equal(await run('saveThresholdsFromInputs()'), false);
  assert.equal(run('__saved'), null);
});


// ── Detailed data (streams) ──
test('Stream stats: histograms, mean-max, decoupling from Strava streams', () => {
  const { run, ctx } = makeEnv();
  // 40 min ride: 20 min at 200 W / 140 bpm, then 20 min at 200 W / 150 bpm (HR drift → decoupling)
  const n = 2400, time = Array.from({ length: n }, (_, i) => i);
  ctx.__streams = { time: { data: time }, watts: { data: time.map(() => 200) },
    heartrate: { data: time.map(i => (i < n / 2 ? 140 : 150)) }, velocity_smooth: { data: time.map(() => 9) } };
  const st = run(`computeStreamStats(__streams, 'cycling')`);
  assert.equal(st.v, 1);
  assert.equal(st.hist.pw['200'], 2400);
  assert.equal(st.hist.hr['140'], 1200);
  assert.equal(st.mmPower['1200'], 200);
  assert.equal(st.mmPower['3600'], undefined);   // longer than the ride
  assert.equal(st.mmSpeed, undefined);           // rides: power curve only
  assert.equal(st.decoupling, 6.7);              // (200/140 − 200/150) / (200/140)
  // Pauses longer than 10 s are not counted as effort
  assert.equal(run(`resample1Hz([0, 1, 100], [5, 5, 5]).length`), 3);
  assert.deepEqual({ ...run(`computeStreamStats({}, 'running')`) }, { v: 1, none: true });
});

test('Zones use the thresholds valid on each activity date; eFTP from best 20 min', () => {
  const { run } = makeEnv();
  run(`thresholdHistory = normalizeThresholdHistory([{ from: '2000-01-01', ftp: 200, lthr: 160, pace: '5:00', swimPace: '2:00' }]);
       allActivities = [
         { sport: 'cycling', startDate: new Date(Date.now() - 5 * 86400000),
           streamStats: { v: 1, hist: { pw: { '200': 600, '100': 300 }, hr: { '150': 600 } }, mmPower: { 1200: 260, 3600: 230 } } },
         { sport: 'cycling', startDate: new Date(Date.now() - 200 * 86400000),
           streamStats: { v: 1, hist: {}, mmPower: { 1200: 400 } } }];`);
  // 205 W / 200 FTP = 1.025 → Z4; 105 W = 0.525 → Z1
  assert.deepEqual([...run(`zoneTotals(allActivities, 'power')`)], [300, 0, 0, 600, 0, 0, 0]);
  // 151 bpm / 160 = 0.94 → Z4 (bounds 0.81, 0.90, 0.94, 1.0)
  assert.deepEqual([...run(`zoneTotals(allActivities, 'hr')`)], [0, 0, 0, 600, 0]);
  // Only the last 90 days count: max(0.95 × 260, 230) = 247
  assert.equal(run(`estimateFtp(allActivities)`), 247);
});

test('Background stream fetch: newest first, saves stats, stops on the rate limit', async () => {
  const { run, ctx } = makeEnv();
  const calls = [];
  ctx.fetch = async url => {
    calls.push(url);
    if (calls.length === 3) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ time: { data: [0, 1, 2] }, heartrate: { data: [120, 121, 122] } }) };
  };
  run(`currentUser = { uid: 'u' }; stravaTokens = { access_token: 'a', expires_at: 9e12 };
       allActivities = [
         { id: 'old', stravaId: '1', sport: 'running', startDate: new Date(2026, 0, 1) },
         { id: 'new', stravaId: '3', sport: 'running', startDate: new Date(2026, 8, 1) },
         { id: 'mid', fileName: 'strava_2', sport: 'running', startDate: new Date(2026, 4, 1) },
         { id: 'done', stravaId: '4', sport: 'running', startDate: new Date(2026, 8, 2), streamStats: { v: 1, hist: {} } },
         { id: 'fit', fileName: 'ride.fit', sport: 'cycling', startDate: new Date(2026, 8, 3) }];
       var __upd = []; updateActivityFields = async (id, f) => { __upd.push(id); return true; };`);
  assert.equal(await run(`backfillStreams({ delayMs: 0 })`), 2);
  assert.match(calls[0], /activities\/3\/streams/);
  assert.match(calls[1], /activities\/2\/streams/);
  assert.deepEqual([...run('__upd')], ['new', 'mid']);
  assert.equal(run(`allActivities[1].streamStats.hist.hr['120']`), 2);
  // Paused after the 429: a new run does nothing
  assert.equal(await run(`backfillStreams({ delayMs: 0 })`), 0);
});

test('Auto-sync waits for activities to load and runs at most every 15 minutes', () => {
  const { run, ctx } = makeEnv();
  ctx.document.hidden = false;
  run(`var __syncs = 0; syncStravaActivities = () => { __syncs++; lastAutoSync = Date.now(); };
       currentUser = { uid: 'u' }; stravaTokens = { access_token: 'a' }; lastAutoSync = 0;`);
  run('maybeAutoSync()');
  assert.equal(run('__syncs'), 0);           // activities not loaded yet → no sync (would re-import everything)
  run('activitiesLoaded = true; maybeAutoSync(); maybeAutoSync();');
  assert.equal(run('__syncs'), 1);           // second call within 15 min is skipped
  run('lastAutoSync = Date.now() - 16 * 60 * 1000; maybeAutoSync();');
  assert.equal(run('__syncs'), 2);
});


// ── Activity detail ──
test('Polyline decoding and downsampling', () => {
  const { run } = makeEnv();
  // Google's reference example
  const pts = run(`decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq\`@')`);
  assert.deepEqual(JSON.parse(JSON.stringify(pts)), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  assert.equal(run(`downsample(Array.from({ length: 5000 }, (_, i) => i), 600).length`), 600);
  assert.equal(run(`downsample([1, 2, 3], 600).length`), 3);
});

test('Activity detail: stats, journal saved on the activity, Strava detail backfills the name', async () => {
  const { run, ctx, el } = makeEnv();
  const calls = [];
  ctx.fetch = async url => {
    calls.push(url);
    if (url.endsWith('/streams?keys=time,heartrate,watts,velocity_smooth,altitude,latlng&key_by_type=true'))
      return { ok: true, status: 200, json: async () => ({ time: { data: [0, 1, 2] }, heartrate: { data: [120, 130, 140] } }) };
    return { ok: true, status: 200, json: async () => ({ name: 'Morning Run <b>', map: {}, laps: [] }) };
  };
  run(`thresholdHistory = normalizeThresholdHistory([{ from: '2000-01-01', ftp: 200, lthr: 160, pace: '5:00', swimPace: '2:00' }]);
       currentUser = { uid: 'u' }; stravaTokens = { access_token: 'a', expires_at: 9e12 };
       allActivities = [{ id: 'x1', stravaId: '42', sport: 'running', startDate: new Date(2026, 8, 1, 7), duration: 3600, distance: 10000,
         avgSpeed: 2.78, avgHr: 145, tss: 70, intensityFactor: 0.85 }];
       var __upd = []; updateActivityFields = async (id, f) => { __upd.push([id, f]); return true; };`);
  await run(`openActivityDetail('x1')`);
  const body = el('activityDialogBody').innerHTML;
  assert.equal(el('activityDialog').open, true);
  assert.match(body, /Avg pace<\/div><div class="detail-stat-value">6:00\/km/);
  assert.match(body, /href="https:\/\/www\.strava\.com\/activities\/42"/);
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(calls.length, 2);
  assert.equal(run(`allActivities[0].name`), 'Morning Run <b>');
  assert.ok(run(`__upd.some(([id, f]) => f.name === 'Morning Run <b>')`));
  // Journal
  el('detailNotes').value = 'Windy, felt strong';
  el('detailRpe').value = '6';
  await run(`setActivityFeel('4')`);
  const last = run(`__upd[__upd.length - 1][1]`);
  assert.deepEqual({ ...last }, { notes: 'Windy, felt strong', rpe: 6, feel: '4' });
  run(`closeActivityDetail()`);
  assert.equal(el('activityDialog').open, false);
});

// ── Fitness per sport ──
test('loadSeries: CTL/ATL maths and per-sport series aligned on the same dates', () => {
  const { run } = makeEnv();
  run(`allActivities = [
         { sport: 'cycling', startDate: new Date(2026, 8, 1, 7), tss: 100 },
         { sport: 'running', startDate: new Date(2026, 8, 1, 18), tss: 50 },
         { sport: 'swimming', startDate: new Date(2026, 8, 3, 7), tss: 42 }];`);
  const s = run(`loadSeries(allActivities, new Date(2026, 8, 1), new Date(2026, 8, 3))`);
  assert.deepEqual([...s.labels], ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.deepEqual([...s.tssVals], [150, null, 42]);
  // Day 1: CTL = 150/42 = 3.57, ATL = 150/7 = 21.43
  assert.equal(s.ctlVals[0], 3.6);
  assert.equal(s.atlVals[0], 21.4);
  assert.equal(s.tsbVals[0], -17.9);
  run(`pmcResult = loadSeries(allActivities, pmcStartDate());`);
  const bike = run(`pmcSeriesFor('bike')`), run_ = run(`pmcSeriesFor('run')`), all = run(`pmcSeriesFor('all')`);
  assert.equal(bike.labels.length, all.labels.length);
  assert.equal(bike.labels[0], '2026-09-01');
  assert.ok(Math.abs(bike.lastCtl + run_.lastCtl + run(`pmcSeriesFor('swim').lastCtl`) - all.lastCtl) < 1e-9); // EWMA is linear
});
