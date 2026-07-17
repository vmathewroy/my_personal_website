# AGENTS.md

This file provides guidance to coding agents working with code in this repository.

## Project Overview

Habit Tracker 2.0 — a habit tracking single-page application built with vanilla JavaScript (no framework, no build system). Users log daily habits through a searchable habit picker, view daily/monthly points charts, and navigate days with a week strip. Editorial light/dark design.

## Development

There is **no build step, no package manager, and no test framework**. The app is three static files served directly by a browser or static host:

- `index.html` — HTML shell, CDN script imports, inline theme-boot script
- `app.js` — All application logic (~1720 lines, ES module)
- `styles.css` — Theme tokens (light + dark via `data-theme`), responsive breakpoints at 400px, 560px, 759px, 900px, and 1120px

To develop, serve the repo root with any static file server (e.g., `npx serve .` or `python3 -m http.server`) and refresh the browser after edits.

## Architecture

**Backend:** Supabase (PostgreSQL + Auth). Credentials are stored in `localStorage` under key `habitTrackerConfig` and prompted from the user on first visit via an in-app `<dialog>`. Theme preference is stored under `habitTrackerTheme`.

**Supabase tables** (full SQL in README.md):
- `habit_categories` — id, category_name
- `habits` — id, name, category (FK), default_points
- `habit_log` — id (uuid), date, habit (FK); points always derive from the joined `habits.default_points`

**Authentication:** Email magic link via Supabase Auth (`signInWithOtp`), with `onAuthStateChange` handling the magic-link return; header button signs in/out.

**External dependencies (all via CDN, no npm):**
- `@supabase/supabase-js@2.39.7` (loaded via dynamic `import()` so the shell renders even if the CDN fails)
- `chart.js@4.4.0`
- `chartjs-plugin-datalabels@2.2.0`
- Google Fonts: Fraunces (display) + Inter (UI)

## app.js Structure

Single ES module organized by commented sections:

1. **Config** — `loadConfig()`, `saveConfig()`, `promptForConfig()` (localStorage)
2. **Dialogs** — `requestFormDialog()` builds the styled `<dialog>` for setup/reconfigure/sign-in
3. **Theme** — `applyTheme()` stamps `data-theme`, persists, and re-renders charts from cache
4. **State** — global `state`: categories, categorySlots, habits, currentUser, selectedDate, categoryFilter (`null` until a chip is picked), searchTerm, selectedHabitId, lastLogIds, cache (dayRows/monthRows/streakRows/prevMonthPoints)
5. **Category colors** — `CATEGORY_PALETTE` (8 light/dark pairs) assigned to categories in fixed sorted order, never re-shuffled
6. **Day navigation** — `selectDate()`, `renderWeekStrip()` (Monday-first), `updateDayContext()`
7. **Quick log** — `renderRecentHabits()` (one-tap pills from cached month rows; selecting one also selects that habit's category), `renderCategoryChips()`, `renderHabitGrid()` (grid is empty until a chip is selected or a search is typed), `selectHabit()`, composer with quantity stepper (max 99)
8. **Logging** — `onRecordHabitClicked()` batch-inserts one row per unit and keeps returned ids; `undoLastLog()` deletes them (toast Undo action); `deleteLogEntry()` removes any single entry via the × on activity rows
9. **Views** — `refreshDay()`/`renderDay()` (stat tiles incl. day streak, aggregated list with per-entry delete, daily chart); `refreshMonth()`/`renderMonth()` (month query + previous-month comparison query drive the metric, trend chart, balance chart, top-5 habits, and recent pills); `refreshStreaks()`/`getStreakData()` (daily + per-habit streaks over a 120-day window); `refreshAllData()` bundles all three
10. **Charts** — `renderCategoryBarChart()` (shared horizontal bars), `renderTrendChart()` (monotone line); instances destroyed before recreation; colors read from CSS variables at render time
11. **Boot** — IIFE: theme → static event wiring → shell render → config → dynamic Supabase import → auth check

## Key Patterns

- **No routing** — one page; panels update in place
- **Chart lifecycle** — `.destroy()` existing Chart.js instances before creating new ones; raw query rows cached in `state.cache` so theme toggles re-render without refetching
- **Date format** — `'en-CA'` locale for YYYY-MM-DD keys everywhere; `state.selectedDate` is the single source of truth
- **Category colors** — always `getCategoryColor(id)`, applied through the `--category-color` CSS custom property
- **DOM safety** — build with `createElement`/`textContent`; never interpolate data into HTML strings
- **Hidden attribute** — a global `[hidden] { display: none !important; }` rule exists because several components set their own `display`
