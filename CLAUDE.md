# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A vanilla JavaScript habit tracking application ("Habit Tracker 2.0") with a Supabase backend. Users log daily habits through a one-tap picker (with search, category chips, and a quantity stepper), review daily and monthly analytics, and navigate days via a tappable week strip. The UI is an editorial paper-and-ink design with light and dark themes.

## Architecture

### Single-Page Application Structure

Pure vanilla JS, no build process, three main files:

- `index.html` - Static shell: topbar (brand, theme toggle, sign in/out), day hero (week strip + date tools), four cards (quick log, daily score, month, most consistent), footer, toast host. Includes an inline `<head>` script that stamps `data-theme` on `<html>` before first paint.
- `app.js` - All application logic (~1720 lines, ES6 module), organized by commented sections: config, dialogs, theme, category colors, Supabase/auth, data loading, day selection, quick log, logging/undo, day view, month view, streaks, charts, event wiring, boot.
- `styles.css` - Theme tokens under `:root`/`:root[data-theme="dark"]`, component styles, responsive breakpoints (400px, 560px, 759px, 900px, 1120px), reduced-motion and print rules.

### Theming

- Theme stored in localStorage (`habitTrackerTheme`); defaults to `prefers-color-scheme`. `applyTheme()` (app.js) re-stamps `data-theme` and re-renders all charts from cached data via `rerenderFromCache()`.
- All colors come from CSS custom properties; charts read them at render time through `getThemeValue()`. Chart chrome tokens: `--chart-grid`, `--chart-tick`.
- A global `[hidden] { display: none !important; }` rule keeps the `hidden` attribute working on elements whose class sets `display`.

### Configuration Management

Supabase credentials live in localStorage (`habitTrackerConfig`), collected on first run via an in-app `<dialog>` (`requestFormDialog()`): Supabase URL, anon/publishable key, auth redirect URL. `initializeConfig()` runs at boot; the footer "Redo setup" button calls `window.reconfigureApp` and reloads after saving.

### State Management

A single global `state` object holds: `categories` (id → name), `categorySlots` (id → palette slot), `habits` (all habits in memory), `currentUser`, `selectedDate` (YYYY-MM-DD), `categoryFilter` (`null` until a chip is picked), `searchTerm`, `selectedHabitId`, `lastLogIds` (for Undo), and `cache` (`dayRows`, `monthRows`, `streakRows`, and `prevMonthPoints` — the raw query results/derived totals, kept so theme changes re-render without refetching).

### Database Schema (Supabase)

Three tables (see README.md for full SQL):

- `habit_categories`: `id`, `category_name`
- `habits`: `id`, `name`, `category` FK, `default_points` (an unused `active` column exists)
- `habit_log`: `id` (uuid PK), `date`, `habit` FK. Points are always derived from the joined `habits.default_points`; there is no per-entry points column. The uuid `id` is what Undo deletes by.

### Authentication

Supabase email OTP (magic link). `checkIfUserIsLoggedIn()` uses `getSession()`, then subscribes to `onAuthStateChange` to catch magic-link returns and cross-tab sign-outs (Supabase calls are deferred out of the callback with `setTimeout` to avoid deadlocks). The header button toggles between Sign in (opens the dialog) and Sign out (`signOut()`). The Supabase library itself is loaded with a dynamic `import()` inside `initializeSupabase()` so the page shell still renders if the CDN is unreachable.

### Quick Log Flow

1. `renderRecentHabits()`: a "Recent" row of up to `RECENT_HABITS_LIMIT` (5) one-tap pills for the most recently logged habits, derived from the cached month rows (no extra query).
2. `renderCategoryChips()` + `renderHabitGrid()`: the grid starts empty (`state.categoryFilter` is `null`) and shows habits only once a category chip is selected (tap again to deselect) or a search term is entered; there is no "All" chip.
3. Tapping a habit (grid or recent pill) calls `selectHabit()` → composer bar appears with quantity stepper (max `MAX_HABIT_QUANTITY` = 99) and Log button.
4. `onRecordHabitClicked()` inserts one `habit_log` row per unit in a single batched `.insert(...).select()`, stores returned ids in `state.lastLogIds`, refreshes everything via `refreshAllData()`, and shows a toast with an Undo action.
5. `undoLastLog()` deletes those ids; `deleteLogEntry()` (the × on each activity row) deletes any single entry by id.

Logging always targets `state.selectedDate`, so past days can be backfilled.

### Day & Month Views

- `refreshDay()` fetches `habit_log` (including `id`, needed for per-entry delete) for the selected date → `renderDay()`: stat tiles (points/entries/categories; the "Day streak" tile is filled separately by `renderStreaks()`), aggregated activity list (repeats collapse to `(N×)` with summed points and a per-row × remove button), and the daily category bar chart.
- `refreshMonth()` runs two parallel range queries — current month (1st → selected day, inclusive) and the same slice of the previous month (`previousMonthRange()`) → `renderMonth()` derives the summary metric with a month-over-month comparison line (`.metric-compare`), points-per-day trend, category balance chart, `renderTopHabits()` (top 5 by count with proportional bars), and the Recent pills.

### Streaks

- `refreshStreaks()` fetches a lightweight `date, habit` window (`STREAK_WINDOW_DAYS` = 120 back from the selected date, newest-first, capped at 1000 rows) into `state.cache.streakRows`.
- `getStreakData()` computes the daily streak (consecutive days with ≥1 log) and per-habit streaks, all ending at the selected date — an empty selected day doesn't break a streak until it's over (counting falls back to the previous day).
- `renderStreaks()` fills the "Day streak" stat tile and re-renders the top-habits list, which shows an accent "N-day streak" pill when a habit's streak is ≥ 2. Rendering is order-independent with `refreshMonth()`.
- `refreshAllData()` = day + month + streaks; used after sign-in, date changes, logging, undo, and deletes.

### Charts (Chart.js + ChartDataLabels via CDN)

- `renderCategoryBarChart()` is shared by the daily and monthly category charts: horizontal bars, every category shown (zeros included), sorted by points descending, solid fills, 4px rounded value-end, thin bars (max 18px), direct value labels in ink (never series-colored).
- `renderTrendChart()`: single-series line, accent colored, monotone cubic interpolation, soft gradient fill, index-mode tooltips.
- `sizeCategoryChart()` sizes the `.chart-canvas` wrapper from the category count so every row fits.
- Always destroy the old instance before creating a new one (`charts[key]?.destroy()`), and update the visually-hidden description paragraph next to each canvas.

### Category Colors

`CATEGORY_PALETTE` holds 8 validated light/dark hex pairs. `assignCategorySlots()` maps category ids (sorted, stable) to slots in fixed order; `getCategoryColor(categoryId)` returns the hex for the current theme. Use it for every category-colored element (chips, habit dots, activity bars, chart fills, top-habit bars) so colors stay consistent everywhere.

### Date Handling

All date keys are `YYYY-MM-DD` via the `en-CA` locale. Helpers: `todayKey()`, `keyToDate()`, `dateToKey()`, `addDays()`, `startOfWeekKey()` (Monday-first), `monthStartKey()`, `formatKey()`. `selectDate()` is the single entry point for changing the day: it re-renders the week strip and labels, then refreshes day+month+streak data via `refreshAllData()`. `updateDayContext()` keeps the hero label (Today/Yesterday/Tomorrow/weekday), "Saving to …" note, month kickers, and date input in sync.

### Dialogs & Toasts

No native `prompt()`/`alert()`. `requestFormDialog()` builds the styled `<dialog>` used for setup, reconfigure, and sign-in. `showToast(message, options)` shows non-blocking feedback; pass `{ action: { label, handler } }` for an inline action button (used for Undo) — action toasts stay visible longer.

## Development Workflow

### Running the Application

Static site — serve the repo root and open it:

```bash
# Using Python
python -m http.server 8000

# Using Node.js http-server
npx http-server -p 8000
```

Then navigate to `http://localhost:8000`

### Making Changes

No build process: edit files, refresh the browser, use DevTools. External dependencies (all CDN): `@supabase/supabase-js` (dynamic import), `chart.js`, `chartjs-plugin-datalabels`, Google Fonts (Fraunces + Inter).

### Testing

No automated tests. Manual checklist:
1. Both themes (toggle + system preference), confirming charts recolor
2. Week strip, prev/next week, date picker, Today button
3. Quick log: search, category chips, recent pills (selecting one also selects its category), habit selection, quantity > 1, Undo
4. Per-entry delete (× on activity rows); day streak, per-habit streak pills, and month-over-month line update on every change
5. Backfilling a past date; charts/lists/top-habits refresh on every change
6. Auth: magic-link sign-in, sign out, the setup and reconfigure dialogs
7. Phone (~375px), tablet (~768px), desktop (≥1120px, sticky quick-log card)

## Code Patterns to Follow

- **Category colors**: always via `getCategoryColor()`; set them on elements through the `--category-color` custom property.
- **Dates**: operate on `state.selectedDate`; never `new Date()` directly for logging.
- **DOM building**: create elements and set `textContent` (never interpolate data into HTML strings).
- **Supabase queries**: use relationship selects, e.g. `.select('date, habits ( name, default_points, category )')`.
- **Charts**: destroy before recreate; read theme values at render time; keep raw rows in `state.cache` so `rerenderFromCache()` works.
- **Accessibility**: `aria-pressed` on toggle-style buttons, `aria-label` on icon-only/compound buttons, `aria-busy` + `setContainerMessage()` for loading/empty/error states, visually-hidden chart descriptions.

## Key Functions Reference

- `initializeConfig()` / `promptForConfig()` / `window.reconfigureApp` - Supabase connection setup
- `requestFormDialog()` - in-app `<dialog>` builder
- `applyTheme()` / `rerenderFromCache()` - theme switching with chart re-render
- `checkIfUserIsLoggedIn()` / `enterSignedInState()` / `signOut()` - auth lifecycle
- `selectDate()` / `renderWeekStrip()` / `updateDayContext()` - day navigation
- `renderCategoryChips()` / `renderHabitGrid()` / `renderRecentHabits()` / `selectHabit()` / `updateComposer()` - quick log UI
- `onRecordHabitClicked()` / `undoLastLog()` / `deleteLogEntry()` - logging, undo, per-entry delete
- `refreshAllData()` - day + month + streaks refresh, used after any data change
- `refreshDay()` / `renderDay()` - daily stats, activity list, daily chart
- `refreshMonth()` / `renderMonth()` / `renderTopHabits()` / `previousMonthRange()` - monthly metric with comparison, trend, balance, top habits
- `refreshStreaks()` / `getStreakData()` / `renderStreaks()` - daily and per-habit streaks
- `renderCategoryBarChart()` / `renderTrendChart()` / `sizeCategoryChart()` - chart rendering
- `getCategoryColor(categoryId)` / `assignCategorySlots()` - stable category colors
- `showToast(message, options)` - feedback, optionally with an action button
