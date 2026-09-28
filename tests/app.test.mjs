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
    getContext: () => ({}), appendChild() {}, querySelector: () => null, scrollIntoView() {} });
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
  for (const f of ['auth.js', 'database.js', 'strava.js', 'app.js']) vm.runInContext(fs.readFileSync(ROOT + f, 'utf8'), ctx, { filename: f });
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
