# Plan import test fixtures

| File | Purpose |
|---|---|
| `plan_short.json` | Current plan format, descriptions < 200 chars, French week dates (`"7 – 13 sept."`), a Monday session, `tss`/`sessionCount` deliberately wrong (must be recomputed) |
| `plan_long.json` | Same plan, descriptions of 1,000–1,500 chars with accents, `\n`, `<`, `>`, `&`, `×`, `→`, `≤` and an emoji |
| `plan_broken_json.json` | Invalid JSON: import must show a clear error |
| `plan_broken_week.json` | Week 3 has no `sessions`: import must name the week and the problem |
| `plan_detailed.json` | Short plan + `name`/`version` and the detailed session fields (`details`, `durationMin`, `hrTarget`, `powerTarget`, `steps`) |

## Diagnosis: why the detailed plan "loaded" but showed nothing (2026-09-28)

Reproduced by running the real `public/js/` code in Node (stubbed DOM) on four variants of the plan,
with both the current code and the code before the HTML-escaping fix (`eaf6a6e`):

| Variant | Sessions rendered | Result |
|---|---|---|
| short | 70 | shown |
| long | 70 | shown (old code: text after `<` could be swallowed, never blank) |
| long, no `ftpWatts` / `generated` / `zwoFile` | 70 | shown |
| **long wrapped in `{"trainingPlan": {...}}`** | **0** | **empty section, title "Training Plan", no error** |

**Root cause of the empty Plan tab: the `"trainingPlan"` envelope.** `importPlanJson` assigned the parsed
object directly and `renderTrainingPlan` read `plan.weeks`, which is `undefined` inside the envelope, so it
rendered zero weeks. Nothing validated the structure, and the only `catch` reported "Invalid JSON", so the
failure was silent. Long descriptions and the missing root fields were **not** the cause.

Other problems found with this plan format (they did not blank the tab but broke features):

1. **Sessions can't be ticked.** The format has no session `id`; all 70 checkboxes shared an empty id, and
   completions were stored under `undefined`, so ticking did nothing. Plan-vs-actual matching skipped them too.
2. **French week dates aren't parsed.** `"7 – 13 sept."` (day first, French month) failed the English-only
   parser → no "this week" highlight, no scroll to the current week, no plan-vs-actual, no weekly goal.
3. **`raceDate` (camelCase) is ignored**; only `race_date` was read (header showed "· ·"), and the plan year
   fell back to the current year.
4. **`\n` in descriptions was collapsed** into one paragraph (no `white-space: pre-line`).
5. **`zwoFile` (camelCase)** wasn't recognised; only `zwo_file` was.
6. Firestore size is **not** a problem today: the long plan is 74 KB of the 1 MiB document limit.
7. No CSS height limit or `overflow: hidden` on session cards; no code assumes a Monday session.
