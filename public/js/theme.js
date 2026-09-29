// ══════════════════════════════════════════════
// Theme: CSS custom properties → Chart.js (Graphite dark / Daylight light)
// ══════════════════════════════════════════════
// Charts are canvas, so they can't use CSS variables directly. Every chart reads its colours through
// C() at build time; when the OS switches between light and dark, charts are rebuilt.

function cssVar(name) { try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; } }

// '#6AA8FF' + 0.5 → 'rgba(106,168,255,0.5)' (also accepts rgb()/rgba() strings)
function withAlpha(color, a) {
  const c = String(color || '').trim();
  let m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) { const [r, g, b] = m[1].split(',').map(s => s.trim()); return `rgba(${r},${g},${b},${a})`; }
  return c;
}

function isLightTheme() {
  const t = document.documentElement && document.documentElement.dataset && document.documentElement.dataset.theme;
  if (t) return t === 'light';
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
}

// Current palette for charts
function C() {
  const light = isLightTheme();
  return {
    ctl: cssVar('--color-ctl') || '#6AA8FF', atl: cssVar('--color-atl') || '#FF6B86', tsb: cssVar('--color-tsb') || '#3DDC97', tss: cssVar('--color-tss') || '#FFC247',
    ok: cssVar('--color-ok') || '#3DDC97', missed: cssVar('--color-missed') || '#F87171',
    text: cssVar('--text-main') || '#EEEFF1', dim: cssVar('--text-dim') || '#A9ADB5', muted: cssVar('--text-muted') || '#858A93',
    grid: light ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.06)',
    raised: cssVar('--bg-raised') || '#1D2025', card: cssVar('--bg-card') || '#15171B',
    sport: { bike: cssVar('--sport-bike') || '#60B8FF', run: cssVar('--sport-run') || '#9BE15D', swim: cssVar('--sport-swim') || '#3FD5D0' },
  };
}

// Shared tooltip + scale styling (handoff "Chart.js rules")
function chartTooltip() {
  const c = C();
  return { backgroundColor: c.raised, titleColor: c.text, bodyColor: c.dim, borderWidth: 0, padding: 10, cornerRadius: 10,
    titleFont: { size: 13, weight: '600' }, bodyFont: { size: 13 }, boxPadding: 4, usePointStyle: true };
}
function chartScaleX(extra = {}) { const c = C(); return { grid: { display: false }, border: { display: false }, ticks: { color: c.muted, maxRotation: 0, autoSkipPadding: 16 }, ...extra }; }
function chartScaleY(extra = {}) { const c = C(); return { grid: { color: c.grid, drawTicks: false }, border: { display: false }, ticks: { color: c.muted, padding: 8 }, ...extra }; }

function applyChartDefaults() {
  if (typeof Chart === 'undefined' || !Chart.defaults) return;
  const c = C();
  Chart.defaults.font.family = "'Geist', system-ui, -apple-system, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = c.muted;
  Chart.defaults.borderColor = c.grid;
  Object.assign(Chart.defaults.plugins.tooltip, chartTooltip());
  Chart.defaults.plugins.legend.labels.color = c.dim;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
}

applyChartDefaults();
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    applyChartDefaults();
    // Rebuild charts with the new palette
    if (typeof buildPMCChart === 'function' && typeof pmcChart !== 'undefined' && pmcChart) buildPMCChart();
    if (typeof updatePlannerForecast === 'function' && typeof plannerChart !== 'undefined' && plannerChart) updatePlannerForecast();
    if (typeof renderBestEfforts === 'function') renderBestEfforts();
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
}
