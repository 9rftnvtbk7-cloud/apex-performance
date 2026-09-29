# Handoff: Apex redesign (Graphite)

## Overview
Visual and IA redesign of Apex, a personal training dashboard (Strava → TSS → CTL/ATL/TSB, imported plan, season forecast). **No new features.** Goals: Today dominates the morning check, one coherent visual system, a real mobile layout (iPhone, installed PWA), and a clearer split between Calendar, Plan and Season.

## About the design files
`Apex Redesign.dc.html` is a **design reference built in HTML** (open it in a browser; it needs `support.js` next to it). It is not production code. Recreate it inside the existing Apex codebase: **vanilla HTML/CSS/JS, one stylesheet with custom properties, BEM-ish classes, Chart.js 4, Leaflet, inline SVG icon sprite.** Keep every existing element ID used by JS (see ID map below).

## Fidelity
**High fidelity** for colours, type, spacing, radii and layout of the screens shown. Screens not drawn (Season, Settings, Sign-in, empty/error states) must be built from the same components and tokens.

## Information architecture (6 tabs → 5)
| Old | New | Notes |
|---|---|---|
| Overview | **Today** | Readiness + today's session + tomorrow + week progress + fitness chart |
| Calendar | **Calendar** | Main place to follow and move sessions (week default on phone, month on desktop) |
| Plan | **Plan** | Library: header, phase bar, week picker, sessions with details/steps/export, import |
| Planner + Compare | **Season** | Segmented: Forecast · Compare · Insights (FTP, zones move here from Overview; a compact FTP + zones row may stay on desktop Today) |
| Log | **Activities** | List on phone, table ≥ 900 px |

Settings, Upload .FIT, Disconnect Strava, debug log, Sign out → **account sheet** (opened from avatar). Tapping any session anywhere opens the same `sessionDialog`.

## Layout
- **Phone (< 1024 px):** header (logo left; sync pill + 34 px avatar right) → page title 34/600 → content in cards with 16 px side margin, 12 px between cards, 28 px before section titles (20/600). Bottom tab bar: 5 items, 24 px icons, 11 px labels, `padding-bottom: calc(8px + env(safe-area-inset-bottom))`, bg `rgba(21,23,27,.94)` + `backdrop-filter: blur(20px)`, top hairline. No horizontal page scroll at 375 px.
- **Desktop (≥ 1024 px):** 232 px sidebar (logo, 5 nav items 15 px with 20 px icons, active = `--bg-raised` pill + 600; bottom: sync status + user row). Main padding 36/40, max width 1400.
- Sync: pull-to-refresh on phone; pill "● Synced 07:02" (green dot = ok, amber = rate-limited, grey = offline, spinner = syncing). Tap pill → sync now.

## Screens
### Today (`#readinessBody`, `#upcomingDays`, `#chartCanvas`)
Order on phone: title "Tuesday 29 Sept" + caption "W04 · Build · 47 days to Saint-Nolff Trail" → **Readiness card** → **Today's session card** → **Tomorrow row** → **This week** → **Fitness** card.
- Readiness card (`--bg-card`, r 24, p 20): 48 px rounded-square icon tinted by level (✓ ready / ! caution / ✕ rest — no numeric score exists), label "Readiness" 13 muted, verdict 21/600 coloured by level ("Ready to train" / "Train, but with care" / "Rest or go very easy"). 2×2 grid of stats (hairline 1 px gaps, cells `--bg-card-sub`): Form, Resting HR, HRV, Sleep; delta coloured + signed. Links "Edit today’s wellness ›" / "Last 7 days ›" open `<details>`/sheet. Desktop: stats become a divided list.
- Session card: top line sport dot + "Today · Bike" and "TSS 55" (tss colour). Title 22/600, description 15 dim, 3-cell target strip (Duration / HR cap / Power), buttons **Mark done** (primary, 48 px) + **Details** (secondary). Desktop adds "↓ .zwo".
- Tomorrow row: compact, chevron, opens session dialog.
- This week: "25 / 300 TSS", status "✓ On track" computed vs **plan to date** (not whole week). Segmented bar: one segment per planned session, flex = planned TSS; done = `--color-ok` fill, today = 1.5 px ink outline, future = `--bg-selected`. Amber status only when behind plan-to-date. Caption "1 of 6 sessions done. Last week 322 TSS across 5 activities."
- Fitness card: 3 metrics with hairline dividers (Fitness 51.7 −3.1/wk, Fatigue 38.3, Form +13.5 Race ready), range segmented 6W/3M/6M/1Y/Custom (Custom opens sheet with the two date inputs), chart, toggle chips (Fitness, Fatigue, Form [off by default], TSS, sport select). Forecast slider/avg TSS move into the chart's "Forecast" chip popover.

### Calendar (`#calendarGrid`, `#sessionDialog`)
- Phone week: prev/next + "W04 · 28 Sept – 4 Oct / Build phase"; summary card (actual vs planned-so-far, e.g. "25 / 25 TSS so far · 100 %", week plan as caption); one row per day: 44 px day column (weekday 12 muted, 32 px date circle, today = ink filled) + session cards.
- Desktop month: 7 columns + 88 px week column, gap 6, cells min-height 108, r 14, `--bg-card`. Legend row with glyphs. Week column: actual TSS 18/600, "of 300 TSS", percentage coloured.
- **Session chip** (both views): `border-left: 3px solid var(--sport-*)`, background/border by compliance, name (wraps, never truncates to < 1 word), second line glyph + TSS ("55→80" = planned→actual).

| State | Background | Border | Glyph | Name |
|---|---|---|---|---|
| done / on target | `--tint-ok` | none | ✓ `--color-ok` | main |
| partly | `--tint-partial` | none | ◐ `--color-partial` | main |
| missed | `--tint-missed` | none | ✕ `--color-missed` | dim + line-through |
| planned | transparent | 1 px dashed `--border-dashed` | ○ muted | main |
| unplanned | `--bg-raised` | none | + muted | main |
| rest | transparent | none | — | muted |

Drag to move stays on desktop; phone uses tap → sheet (tick / move to date), long-press to drag.

### Plan (`#planWeeks`)
Header card: plan name 20/600 + version tag (`--bg-raised`, r 6, 12/600), meta line, **phase bar** (4 segments flex = weeks; current phase ink-filled; caption "You are in W04"), footer "Zones ›" + plan status. Import button top-right (sheet: JSON / ZWO). Import errors: persistent status panel under header naming week/session (`--tint-missed`, ✕ glyph). Week picker chips W01…W10 (horizontal scroll inside the chip row only). Session list inside one card with row dividers: 26 px checkbox (done = green filled ✓), sport·day caption, title 15/600, TSS right. Expanded row (`--bg-card-sub` bg): targets line, Markdown details (h2 → 14/600, paragraphs 14 dim, **bold** = main colour), steps table (header `--bg-raised`, rows 13 px, hairline gaps), export buttons "↓ .zwo · Zwift" / "↓ .fit · Garmin".

### Activity detail (`#activityDialog`)
Full-screen sheet on phone, 720 px dialog on desktop. Nav "‹ Activities" + "View on Strava" (Strava orange, 600). Title 30/600, sport dot + "Run · Sun 27 Sept · 07:00". Hero trio 28/600 (Distance, Moving time, Elevation). 3×2 stat grid (Avg pace, Avg HR, Max HR, TSS [tss colour], IF, Decoupling). Map (Leaflet, dark tiles e.g. CARTO Dark Matter; light theme → Positron) r 18, 190 px. Chart card with segmented Heart rate / Pace / Elevation (one Chart.js canvas, swap dataset), HR zones bar beneath. "How did it feel?": RPE 1–10 segmented (34 px), Feel 5 labelled steps Awful/Poor/OK/Good/Great (replaces emoji), notes textarea. Laps as compact 4-col list (Lap, Dist, Pace, HR; power column appears for rides).

### Activities (`#tableBody`)
Phone: title + "Select" (enters multi-select, checkboxes replace sport tile, delete bar appears above tab bar). Search field, filter chips (All/Run/Bike/Swim + Sort). Grouped by week: group header (15/600 + summary caption) then card of rows: 36 px sport tile, name 15/600, date 13 muted, right: primary metric + "duration · TSS". ≥ 900 px: existing sortable table, 44 px rows, header 12 muted uppercase, numbers right-aligned tabular, row hover `--bg-raised`.

### Not drawn — build from the same parts
- **Season**: Forecast (race cards, target solver as a form row, result as 3 hero numbers, weekly TSS grid → list of week rows on phone with stepper inputs; presets as secondary buttons without emoji), Compare, Insights.
- **Settings** (sheet): threshold rows (FTP, LTHR, run pace, swim CSS) with "effective from" date + history list; danger zone at bottom in a separate card with a red-text button.
- **Sign-in**: centred ▲ mark 56 px, "Apex" 34/600, one-line pitch 15 dim, Google button (white, 48 px).
- **Empty/edge states**: centred in a card, 17/600 title + 15 dim line + one primary action. No activities → official "Connect with Strava" button + secondary "Upload .FIT". No plan → "Import a plan (JSON)". No wellness → readiness card shows "Log how you feel" button instead of the grid. Detailed data loading → thin progress bar + "Detailed data for 120 of 340 activities". Offline / rate-limited → sync pill state + toast.
- **Toast**: bottom, above tab bar, `--bg-raised`, r 14, `--shadow-sheet`, 14 px text, optional action link.

## Components → classes (suggested)
`.app-header`, `.sync-pill[data-state]`, `.tabbar` / `.tabbar__item[aria-current]`, `.sidebar` / `.sidebar__item`, `.card` (`--bg-card`, r-xl, p 20), `.stat-grid` / `.stat` (`__label` 12 muted, `__value` 16–18/600, `__delta--up|--down`), `.readiness` / `.readiness__ring` / `.readiness__verdict--care|--ready|--rest`, `.session-card` (`--today`), `.session-row` (`--done|--missed|--expanded`), `.chip-session` (`--ok|--partial|--missed|--planned|--unplanned|--rest`), `.week-progress` / `__seg--done|--today|--future`, `.segmented` / `__opt[aria-pressed]`, `.btn` (`--primary` ink bg/`--accent-contrast` text, `--secondary` `--bg-raised`, `--strava`), `.toggle-chip[aria-pressed]`, `.phase-bar`, `.list-group` / `.list-row`, `.empty-state`, `.status-panel--error|--info`, `.toast`.

Buttons: height 44 (48 for main CTA), r 12–14, 15/600 primary, 15/500 secondary. Focus: `outline: 2px solid var(--color-ctl); outline-offset: 2px` on all interactive elements. Pressed (touch): `transform: scale(.98)`, 80 ms.

## Element ID map
All existing IDs stay. New placements: `readinessBody` → readiness card body; `upcomingDays` → today card + tomorrow row container; `chartCanvas` → Today fitness card; `plannerChart` → Season › Forecast; `planWeeks` → Plan session list card; `calendarGrid` → Calendar (week or month); `activityDialog`, `sessionDialog` → native `<dialog>` styled as sheets (`.sheet`) on < 1024 px; `tableBody` → Activities (render list markup on phone, `<tr>` on desktop — or render both and toggle with CSS); `settingsPanel`, `accountMenu` → inside the account sheet.

## Chart.js rules
```js
Chart.defaults.font.family = 'Geist'; Chart.defaults.font.size = 12;
Chart.defaults.color = getCss('--text-muted');
// scales: x grid display:false; y grid color 'rgba(255,255,255,.06)', drawTicks:false, border display:false
// CTL:  borderWidth 2.5, tension .3, pointRadius 0, pointHoverRadius 4, fill {target:'origin', above: ctl @ 8%}
// ATL:  borderWidth 1.5, colour at 60% alpha, pointRadius 0
// TSB:  hidden by default; fill to 0 with tsb @ 10%, borderWidth 1.5
// TSS:  type 'bar', own y-axis occupying bottom ~16% (y2 max = 140/0.16), barThickness 2–3, colour tss @ 55%
// Forecast: same dataset colours, segment.borderDash [4,4] after today index
// Race: annotation-like vertical line 1.5 px --color-tss + label chip (bg tss, text #0C0D10, r 6, 12/600)
// Today: vertical line ink @ 35%
// Tooltip: bg --bg-raised, border none, r 10, padding 10, titleFont 13/600, bodyFont 13, mode 'index', intersect false
// Form zone bands: remove from default; show only when Form toggle is on, as 4% tints
```
Legend: disable Chart.js legend; use `.toggle-chip` buttons that set `dataset.hidden`.

## Icons
Keep the 24×24 line sprite, stroke 1.8, round caps. Remove all emoji (Strava 🔶 → Strava wordmark/orange dot only in Strava UI; feel buttons → labelled scale; planner presets → text; 🏁 → race chip; readiness → ring).

## Tokens
See `apex-tokens.css` (dark default + light via `prefers-color-scheme`, `data-theme` override). Fonts: Google Fonts `Geist` 400/500/600/700 and `Geist Mono` 400/500. Replace JetBrains Mono for numbers with Geist + `font-variant-numeric: tabular-nums`.

## Implementation map (checked against repo main @ d0fa8a8, 29 Sept 2026)
Work order: tokens → shell (header/nav) → Today → Calendar → Plan → Activity → Log → Season. Validate with `node --check` + `node --test tests/` and bump every `?v=` cache-buster (see CLAUDE.md). Keep `escapeHtml()` / `safeColor()` on every templated value.

**Fonts** — index.html: replace the DM Sans + JetBrains Mono link with `family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500`. Chart.js font family → Geist; tick colours read `--text-dim` / `--text-muted`. `<meta name="theme-color">` → #0C0D10.

**Tokens** — styles.css lines 4–21. Keep old names as aliases so existing rules keep working: `--bg-surface: var(--bg-card-sub)`, `--bg-hover: var(--bg-raised)`, `--color-blue: var(--color-ctl)`, `--color-red: var(--color-atl)`, `--color-green: var(--color-tsb)`, `--color-amber: var(--color-tss)`, `--color-purple: var(--sport-strength)`, `--color-cyan: var(--sport-swim)`.

**Shell (index.html)**
- .app-header: keep #stravaStatus, #btnStravaConnect, #btnStravaSync, #btnSettings, #btnAccount, #accountMenu, #userAvatar, #userName. Under 1024 px hide #btnSettings and .btn-label; restyle #btnStravaSync as .sync-pill. Add a "Settings" item to #accountMenu calling toggleSettings(). Remove 🔶 🔍 ⎋ 🗑 from labels.
- .nav-tabs: 6 switchTab() buttons → 5: overview (label "Today"), calendar, plan, new season, log (label "Activities"). Season = wrapper #tab-season with a .segmented control toggling the existing #tab-planner and #tab-compare contents (inner IDs unchanged). #insightsCard moves to Season › Insights.
- Phone tab bar (styles.css @media max-width 600px): add padding-bottom calc(8px + env(safe-area-inset-bottom)) and backdrop blur.

**Today (#tab-overview)** — reorder #overviewContent: #readinessCard → #upcomingCard → #weekSummary → PMC card. Replace .stat-cards with a .pmc-stats row inside the PMC card; keep #valCtl #subCtl #valAtl #valTsb #subTsb. #valWeekTss #subWeekTss #valLastWeekTss #subLastWeekTss move into #weekSummary. #sportFitness becomes the "By sport" group in that row. setChartRange buttons → .segmented; #chartRangeFrom/#chartRangeTo move into <details class="range-custom"> ("Custom"). .forecast-bar (#sliderForecastDays, #displayForecastDays, #inputForecastTss) goes into a <details> behind the "Forecast" chip. .chart-legend-item keep toggleChartDataset(i); TSB (index 2) hidden by default. The 4 .week-summary-sport tiles collapse to one caption on phones (IDs kept).

**Readiness — wellness.js › renderReadiness()** (there is no score; don't add one)
```html
<div class="readiness readiness--${r.level}">
  <div class="readiness__icon" aria-hidden="true">${ {ready:'✓',caution:'!',rest:'✕'}[r.level] }</div>
  <div><div class="readiness__label">Readiness</div><div class="readiness__verdict">${escapeHtml(r.label)}</div></div>
</div>
<ul class="readiness-reasons">…unchanged li.is-${level}…</ul>
<div class="readiness__links">…details.wellness-form-wrap… …details.wellness-history…</div>
```
Colour via modifier instead of inline style="color:${r.color}". The mock's 4-cell grid = today's entry values (restingHr, hrv, sleepHours) + Form, deltas coloured from the matching reason level. No reasons → verdict + "Nothing unusual today." No entry today → details.wellness-form-wrap stays open (current behaviour) as the card's main content.

**Upcoming — app.js ~1540**: day 0 → .session-card--today (title, desc, .plan-session-meta as 3-cell .target-strip, the existing checkbox restyled as a "Mark done" button, "Details" → openSessionDialog(id)); day 1 → compact .list-row "Tomorrow · Wed 30". Keep .upcoming-session.is-done, .plan-session-actual.

**Calendar — calendar.js › renderCalendar()** (complianceOf() logic unchanged)
```html
<button class="btn-reset cal-chip cal-chip--${c}" style="--sport:var(--sport-${sport})" aria-label="${name}, ${complianceWord}" …same data/handlers…>
  <span class="cal-chip-name">${name}</span>
  <span class="cal-chip-meta"><span class="cal-chip-glyph" aria-hidden="true">${ {green:'✓',amber:'◐',red:'✕',planned:'○',rest:''}[c] }</span><small>${tss}${m ? '→'+m.tss : ''}</small>${moved ? ' ↪' : ''}</span>
</button>
```
- Sport shown by `border-left: 3px solid var(--sport)`; drop sportIcon() in chips. Unplanned: sportEmoji() → glyph "+".
- .cal-chip-name: allow 2 lines (-webkit-line-clamp: 2), no nowrap.
- Week view (default ≤ 600 px): each .cal-day is a row (44 px date column + full-width chips) with short sessionMetaHtml(s) as a meta line.
- .cal-week keeps the plannedSoFar rule; colour via .cal-week--green|amber|red|planned text colour, no coloured border.
- openSessionDialog(): bottom sheet on phones (CSS on #sessionDialog); .session-tick → primary "Mark done"; .session-move unchanged.

**Plan — app.js ~1470–1590 renderTrainingPlan()**
- #planHeader: add .phase-bar from plan.weeks[].phase (group consecutive phases, current filled). Remove emoji from #btnImportPlan 📥, #btnImportZwo 📦, zones toggle 📊, #planEmpty 📋.
- Add a week-picker chip row; jump with window.scrollTo (never scrollIntoView). Remove the inline border-left on .plan-week-header; phase colour on .plan-week-phase text only.
- .plan-session: keep the real checkbox (visually hidden) behind a 26 px .check; .plan-session-sport pill → sport dot + "Tue · Bike" caption; .plan-session-missed → ✕ + "missed"; .plan-session-actual unchanged. Open .plan-session-details → --bg-card-sub.
- #planImportStatus → .status-panel--error / --info.

**Activity — activity-detail.js**: hero trio + 3×2 stat grid; one canvas with .segmented HR / Pace / Elevation (three stacked charts can stay on desktop). Feel: labels Awful/Poor/OK/Good/Great (same values). RPE select → 10-button segmented writing the same field. Leaflet: dark tile layer with OSM attribution. "View on Strava" stays.

**Log (#tableBody)**: under 900 px render a sibling <ul id="logList"> with list rows and hide the table via CSS (or one <td colspan> per row). Keep sortColumn(), #selectAllCheckbox, #btnDeleteSelected, #selectedCount, #activityCount.

**Planner**: remove emoji from presets, "🏁 Race dates", "🎯 Race-day target". #plannerGrid → list rows with number inputs under 600 px (drop overflow-x wrapper). .planner-summary → same .pmc-stats row.

**Toasts**: showToast(msg, emoji) is called with 📅 ✅ ❌ — change the 2nd arg to a type ('info'|'ok'|'error') rendering a glyph.

**Empty state** #uploadDropzone: replace "🔶 Connect Strava" with Strava's official "Connect with Strava" button.

## Files
- `Apex Redesign.dc.html` — review, IA, directions (1a Graphite recommended, 1b Daylight = light theme), system, 5 phone screens, 2 desktop screens
- `support.js` — runtime needed to open the reference file
- `apex-tokens.css` — custom properties to paste into the stylesheet
