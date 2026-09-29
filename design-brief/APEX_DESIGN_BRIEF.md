# Apex — Redesign brief

**For:** Claude Design · **From:** Tristan Guilbot (owner and only user) · **Date:** 29 Sept 2026
**App:** https://apex-performance-1fe0a.web.app (Google sign-in required — use the screenshots in `screens/`)

## 1. What Apex is

Apex is a personal training dashboard for an **amateur triathlete and trail runner**. Activities arrive automatically
from **Strava**; Apex turns them into training-load science (TSS → fitness / fatigue / form), shows whether the athlete
follows their **imported training plan**, and helps plan the season up to a **target race**.

It works well functionally. It has grown feature by feature, and now needs a **coherent visual design, clearer
hierarchy and a better mobile experience**. Please redesign it; don't add features.

## 2. The user

- One person: Tristan, adult endurance athlete (bike, run, swim, strength), training for a 30 km trail race (Nov 2026).
- Uses it **mostly on an iPhone (Safari, installed to the home screen)**, and on a desktop browser for weekly reviews.
- Bilingual: the app UI is **English**, but training content (plan names, session descriptions, notes) is often
  **French**. Design for long French strings (accents, `×`, `→`, `≤`), no French date/number formats needed.
- Knows the concepts (CTL, ATL, TSB, TSS, FTP, zones); wants density where it helps, not a beginner tutorial.

## 3. Key moments (design for these first)

| When | What they want in < 10 seconds | Where today |
|---|---|---|
| **Morning, on the phone** | "Am I ready? What is today's session?" — readiness verdict + today's planned session, tick it later | Overview → Today, Next 2 days |
| **After a workout** | New activity synced, check it (map, HR/pace), add RPE / feel / notes | Log → activity detail |
| **Weekly review (desktop)** | Did I follow the plan? Planned vs actual TSS, missed sessions, move sessions | Calendar, Plan |
| **Season planning** | Where will my fitness be on race day? What load do I need? | Planner (forecast + race-day target) |
| **New plan** | Import a detailed plan JSON, read session details (warm-up, sets, targets), export workouts to Zwift / Garmin | Plan tab |

## 4. Screens (current state — see `screens/`)

Navigation: 6 tabs — **Overview, Plan, Calendar, Compare, Planner, Log**. On phones they are a bottom tab bar.
Header: logo, Strava status + Sync, Settings, account menu (Upload .FIT, Disconnect Strava, debug log, Sign out).

| Screen | Contents | Screenshots |
|---|---|---|
| **Overview** | Today (readiness verdict + reasons, wellness form, 7-day wellness table) · Next 2 days (planned sessions, tick) · 5 stat cards (CTL + ramp, ATL, TSB + zone, this week / last week TSS) · fitness by sport chips · Performance Management Chart (CTL/ATL/TSB lines, TSS dots, forecast, form-zone bands, race markers, sport + range selectors) · This week by sport + progress vs planned TSS · Training insights (estimated FTP, HR / power time in zones) | `desktop-01-overview`, `mobile-01-overview` |
| **Plan** | Import JSON / ZWO · plan header (name, version, race, dates, FTP) · status panel for import errors · zones · weeks → sessions (tick, sport, name, TSS, actual TSS ✓ or "missed", duration / HR / power targets, expandable Markdown details + steps table + ⬇ .zwo / .fit) | `desktop-02-plan`, `mobile-02-plan` |
| **Calendar** | Month / week view, planned sessions coloured by compliance (green / amber / red / planned / unplanned), weekly planned vs actual, drag to move, tap → session dialog (tick, move to date) | `desktop-03-calendar-month`, `desktop-04-calendar-session`, `mobile-03-calendar-week` |
| **Compare** | Period comparison (date range / year vs year / month vs month; totals or cumulative) · Best efforts (power / pace curves vs all-time) | `desktop-05-compare` |
| **Planner** | 26-week TSS grid with presets · projected CTL/ATL/TSB · race dates · race-day target solver (target CTL/TSB, taper → weekly TSS, warnings, apply) · forecast chart | `desktop-06-planner` |
| **Log** | Sortable table of all activities (date, name, sport, duration, distance, TSS, IF, HR, power, energy), multi-select delete | `desktop-07-log`, `mobile-05-log` |
| **Activity detail** (dialog) | Stats grid, RPE / feel / notes, route map (Leaflet/OSM), HR / pace / power / elevation charts, zones, laps, "View on Strava" | `desktop-08-activity-detail`, `mobile-04-activity-detail` |
| **Settings** (panel) | Thresholds (FTP, LTHR, run pace, swim CSS) with "effective from" date and history table · danger zone (delete all) | `desktop-09-settings` |
| **Account menu** | Upload .FIT, Disconnect Strava, debug log, Sign out | `desktop-10-account-menu` |
| **Sign-in** | Logo, one-line pitch, Google sign-in | `desktop-11-sign-in` |

Empty / edge states that must be designed too: no activities yet (Strava-first onboarding: "Connect Strava", secondary
".FIT upload"), no plan loaded, plan import error (persistent panel naming the week/session), no wellness logged today,
detailed Strava data still loading ("detailed data for 120 of 340 activities"), offline, Strava rate-limited.

## 5. What feels wrong today (my view — challenge it)

1. **Overview is a long scroll of equal-weight cards.** Today + next session should dominate; the chart, stats,
   insights compete. Five stat cards + chips + a dense chart + a week summary + insights = too much at once.
2. **The PMC chart is busy**: three lines, ~180 TSS dots, dashed forecast, shaded bands and race markers on one
   axis; the date-range inputs add clutter. Needs a clearer visual hierarchy (fitness first).
3. **Three planning surfaces** (Plan, Calendar, Planner) overlap conceptually. Suggest a clearer information
   architecture (e.g. Calendar as the main plan view, Plan as the library/detail, Planner as "Season").
4. **"Card soup" and inconsistent spacing**: many borders and boxes, inline styles, spacing that varies by screen.
5. **Typography**: DM Sans + JetBrains Mono. Mono is used for all numbers *and* for dates in tables, which reads as
   code. Numbers should stay tabular, but the hierarchy needs work.
6. **Leftover emoji** in a few places (Strava 🔶, feel buttons, planner presets, race 🏁, readiness) next to the new
   line-icon set — pick one language.
7. **Mobile tables** (Log, Planner grid) scroll horizontally; they probably want a list/card pattern on phones.
8. **Header** is crowded on phones (Strava status + Sync + Settings + account wraps onto two lines).
9. "This week TSS = **0**" on a Monday morning reads as failure; progress should feel encouraging, not punitive.
10. Dark theme only. A light theme is welcome if it doesn't cost clarity (outdoor use on a phone).

## 6. Hard constraints (implementation reality)

- **Tech:** vanilla HTML / CSS / JS, **no framework, no build step**. Styles live in one CSS file with custom
  properties (tokens) and BEM-ish class names. Charts are **Chart.js 4** (canvas — style via its options: colours,
  fonts, gridlines), maps are **Leaflet + OpenStreetMap tiles**. Icons: an inline SVG sprite (24×24 line icons).
- **Keep behaviour and data**: every feature in §4 stays. Element IDs used by the JavaScript must keep existing (or be
  mapped explicitly in your handoff), e.g. `chartCanvas`, `plannerChart`, `planWeeks`, `calendarGrid`,
  `activityDialog`, `sessionDialog`, `readinessBody`, `upcomingDays`, `tableBody`, `settingsPanel`, `accountMenu`.
  Markup for lists (sessions, calendar days, table rows, readiness reasons) is generated in JS as HTML strings, so
  give component specs I can translate into those templates.
- **Mobile first**: must work at **375 px** with no horizontal page scroll, thumb-reachable bottom navigation, iOS
  safe areas (installed app, `viewport-fit=cover`). Desktop up to ~1400 px wide.
- **Safari/iOS**: no hover-only interactions; native `<dialog>`, `<details>`, `<select>`, date inputs are used.
- **Accessibility (already met — keep it):** WCAG AA text contrast on every background, visible focus rings,
  real buttons (keyboard), labelled inputs, colour never the only signal (compliance colours need a second cue).
- **Strava brand rules:** "Connect with Strava" must use Strava's official button style; show "View on Strava"
  links on Strava data; Strava orange `#FC4C02` only for Strava-related UI.
- **Semantic colours are data**: fitness (CTL) blue, fatigue (ATL) red/pink, form (TSB) green, TSS amber, and
  compliance green / amber / red. You may change the hues, but keep them distinct from each other and from the accent.

## 7. Current design tokens (starting point, not a requirement)

```css
--bg-base: #0a0b0f;  --bg-surface: #12141c;  --bg-card: #181a24;  --bg-hover: #1e2030;  --border-color: #2a2d3e;
--text-main: #e8eaf0; --text-dim: #a3a8bc;  --text-muted: #858aa3;   /* both ≥ 4.5:1 on all backgrounds */
--color-blue: #3b82f6 (CTL, accent) · --color-red: #f43f5e (ATL) · --color-green: #10b981 (TSB, on-target)
--color-amber: #f59e0b (TSS, partial) · --color-purple: #8b5cf6 · --color-cyan: #06b6d4 · Strava: #fc4c02
Fonts: DM Sans (UI) · JetBrains Mono (numbers) — Google Fonts. Radii 8–16 px. Cards: 1 px border, 16 px radius.
```
Sport identity (icons + colours): bike blue, run green, swim cyan, strength purple, rest grey, race amber.

## 8. Realistic data for mockups

- CTL 51.7 (ramp −3.1/wk), ATL 38.3, TSB +13.5 "Fresh — race ready"; this week 0 → 300 planned; last week 322.
- Fitness by sport: Bike 14, Run 32, Swim 6. Estimated FTP 241 W (current 235 W, "Use 241 W from today"). HR zones last 28 days: Z1 25 %, Z2 65 %, Z4 10 %.
- Readiness: "Train, but with care" — resting HR 52 bpm (+4 vs 7-day avg), HRV 61 ms (−13 %), sleep 6.5 h.
- Today: *W04 Tue – Vélo Tempo 3×8min* · 50 min · ≤160 bpm · 170 W (85 % FTP) · TSS 55.
  Tomorrow: *W04 Wed – Footing Z2* · 1 h · ≤150 bpm · TSS 40.
- Plan: "Saint-Nolff Trail 30K — 10-week plan" **v2.1**, race 15 Nov 2026, 10 weeks / 70 sessions, phases BASE → BUILD → PEAK → TAPER.
- Activity: *Fractionné côtes* — running, 1 h 36, 16.8 km, 483 m D+, TSS 102, 5:45/km, HR 142 / 167, decoupling 6 %, 6 laps.
- Long French session details (Markdown): "## Échauffement / - 10min progressif **Z1→Z2** (FC ≤ 135 bpm) …"

## 9. What I'd like back

1. **Design direction**: 2 short options (mood, type, colour, density) with a recommendation.
2. **Design system**: tokens (colour incl. light theme if proposed, type scale, spacing, radii, elevation), chart
   styling rules for Chart.js (lines, dots, bands, gridlines, tooltips), icon guidance.
3. **Components**: header, bottom tab bar, stat tile, readiness card, session card (collapsed / expanded / done /
   missed / matched), calendar day cell + chips, table ↔ mobile list, dialog, form fields, buttons, status panels,
   empty states, toasts.
4. **Screens** for phone (375 px) and desktop (1280 px): Overview, Plan, Calendar (month + week), Activity detail,
   Planner, Log, Settings, Sign-in, plus the empty / error states in §4.
5. **Information architecture** recommendation for Plan / Calendar / Planner (§5.3).
6. **Handoff notes**: CSS custom properties and class names I can drop into the existing stylesheet, and where the
   markup of JS-generated components should change.

Out of scope: new features, backend, logo redesign (the ▲ mark stays; a refresh of its rendering is fine).
