# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

A habit tracking single-page application built with vanilla JavaScript (no framework, no build system). Users log daily habits by category and view points charts and monthly progress.

## Development

There is **no build step, no package manager, and no test framework**. The app is three static files served directly by a browser or static host:

- `index.html` — HTML structure, CDN script imports
- `app.js` — All application logic (~900 lines, ES module)
- `styles.css` — Dark-theme styling with CSS variables, responsive breakpoints at 768px and 1024px

To develop, open `index.html` in a browser or serve via any static file server (e.g., `npx serve .` or `python3 -m http.server`).

## Architecture

**Backend:** Supabase (PostgreSQL + Auth). Credentials are stored in `localStorage` under key `habitTrackerConfig` and prompted from the user on first visit.

**Supabase tables:**
- `habit_categories` — id, category_name
- `habits` — id, name, category (FK), default_points
- `habit_log` — date, habit (FK), recorded_points

**Authentication:** Email-based OTP via Supabase Auth (`signInWithOtp`).

**External dependencies (all via CDN, no npm):**
- `@supabase/supabase-js@2.39.7`
- `chart.js@4.4.0`
- `chartjs-plugin-datalabels@2.2.0`

## app.js Structure

The entire app lives in a single ES module organized by concern:

1. **Config management** (top) — `loadConfig()`, `saveConfig()`, `promptForConfig()` using localStorage
2. **Global state** — `state` object holds `categories` (Map), `categoryColors` (Map), `habits` array, `currentUser`, `selectedDate`
3. **Category colors** — `CATEGORY_COLORS` array of 12 color pairs, assigned via hash of category ID
4. **Data fetching** — `loadCategories()`, `loadAllHabits()`, `fetchAndDisplayLoggedPoints()`, `fetchAndDisplayProgress()`
5. **Chart rendering** — `renderPointsChart()` (daily bar chart), `renderProgressChart()` (monthly horizontal bar). Charts are destroyed and recreated on each render.
6. **Event handling** — Cascading dropdowns (category → habit → record button), date navigation with prev/next arrows
7. **Initialization** — IIFE `initializeApp()` at bottom: load config → init Supabase → check auth → load data

## Key Patterns

- **No routing** — everything renders on a single page with show/hide of sections
- **Cascading dropdowns** — selecting a category filters the habit dropdown, selecting a habit shows the record button
- **Chart lifecycle** — existing Chart.js instances are `.destroy()`ed before creating new ones to avoid canvas reuse errors
- **Date format** — `'en-CA'` locale used throughout for YYYY-MM-DD formatting
