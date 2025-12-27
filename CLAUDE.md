# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A vanilla JavaScript habit tracking application with Supabase backend. The app allows users to log daily habits, track progress with visual charts, and navigate through historical data.

## Architecture

### Single-Page Application Structure

This is a pure vanilla JS application (no build process) with three main files:

- `index.html` - Static HTML structure with minimal markup
- `app.js` - All application logic (900 lines, ES6 module)
- `styles.css` - Dark-themed responsive CSS

### Key Architecture Patterns

**Configuration Management**: The app uses localStorage to store Supabase credentials. On first run, it prompts users for:
- Supabase URL
- Supabase API Key
- Redirect URL for auth

Configuration is loaded via `initializeConfig()` at app startup (app.js:86-94).

**State Management**: A single global `state` object (app.js:125-131) holds:
- `categories`: Map of category IDs to names
- `categoryColors`: Cached color assignments for consistency
- `habits`: All habits loaded into memory on startup
- `currentUser`: Current authenticated user
- `selectedDate`: Currently selected date for viewing/logging

**Data Flow**:
1. App initializes → checks config → initializes Supabase client
2. Checks auth → if logged in, loads all habits and categories into memory
3. User interactions update the selected date or log new habits
4. UI refreshes by re-fetching and displaying data for the selected date

### Database Schema (Supabase)

Three main tables (configured via `CONFIG.tables` in app.js:11-15):

- `habit_categories`: Category definitions
- `habits`: Individual habits with name, category FK, and default_points
- `habit_log`: Daily habit recordings with date, habit FK, and recorded_points

The app uses Supabase's auto-generated foreign key relationships for joins.

### Authentication

Uses Supabase email OTP (magic link) authentication. The flow:
1. `checkIfUserIsLoggedIn()` (app.js:290) checks for existing session
2. If no session, prompts for email and sends magic link via `loginWithEmail()` (app.js:311)
3. User clicks link → redirects to app → session established

### Chart Rendering

Two Chart.js charts with ChartDataLabels plugin:

**Daily Points Chart** (`renderPointsChart`, app.js:161-272):
- Vertical bar chart showing points per category for selected date
- Always shows all categories (even with 0 points)
- Uses consistent color mapping per category ID via hash function

**Monthly Progress Chart** (`renderProgressChart`, app.js:596-706):
- Horizontal bar chart showing cumulative points by category
- Shows current month up to previous day
- Sorted by points (descending)

**Color Assignment**: Categories get consistent colors via `getCategoryColor()` (app.js:141-155) which hashes the category ID to pick from `CATEGORY_COLORS` array.

### Date Handling

The app uses `en-CA` locale format (YYYY-MM-DD) throughout for consistency with date inputs and database storage. State tracks `selectedDate` which drives all data fetching. Navigation buttons (prev/next) manipulate this date.

## Development Workflow

### Running the Application

This is a static web application. To run locally:

```bash
# Using Python
python -m http.server 8000

# Using Node.js http-server
npx http-server -p 8000
```

Then navigate to `http://localhost:8000`

### Making Changes

Since this is vanilla JS with no build process:
1. Edit files directly
2. Refresh browser to see changes
3. Use browser DevTools for debugging

### Testing

No automated tests exist. Manual testing workflow:
1. Test with different Supabase instances
2. Verify date navigation (previous/next days)
3. Check habit logging for both today and historical dates
4. Verify charts render correctly with varying data
5. Test authentication flow (logout/login)

## Code Patterns to Follow

### Color Consistency

When adding features that display categories, always use `getCategoryColor(categoryId)` to ensure consistent colors across charts and lists.

### Date Handling

Always use `state.selectedDate` for operations. When recording habits, use the selected date (app.js:812), not `new Date()`.

### Supabase Queries

The app uses Supabase's `.select()` with relationship syntax for joins:

```javascript
await supabase
    .from('habit_log')
    .select(`
        date,
        habits (
            name,
            default_points,
            category
        )
    `)
    .eq('date', date)
```

### Chart Updates

Always destroy existing chart instances before creating new ones:

```javascript
if (pointsChart) {
    pointsChart.destroy();
}
pointsChart = new Chart(ctx, {...});
```

## Key Functions Reference

- `initializeConfig()` - Loads or prompts for Supabase config
- `checkIfUserIsLoggedIn()` - Auth check and app initialization
- `loadAllHabits()` - Loads habits into memory (called once at startup)
- `fetchAndDisplayLoggedPoints(date)` - Main function to display logged habits for a date
- `fetchAndDisplayProgress(currentDate)` - Displays monthly progress up to previous day
- `onRecordHabitClicked()` - Handles habit logging (app.js:785)
- `getCategoryColor(categoryId)` - Consistent color assignment

## Important Implementation Details

### Recording Habits for Selected Date

The app allows logging habits for any date (not just today). When recording, it uses `state.selectedDate` (app.js:812), allowing users to backfill historical data.

### In-Memory Data Loading

All habits and categories are loaded into memory once at startup (`loadAllHabits()` and `loadCategories()`). This enables:
- Fast category → habits filtering without additional queries
- Dropdown population without lag
- Reduced database calls

### Chart Rendering Strategy

Charts show all categories regardless of whether they have points:
- Daily chart: Shows all categories, defaulting to 0 if no data
- Monthly chart: Only shows categories with points > 0, sorted descending

### Authentication State

After successful login, the app loads all necessary data in sequence:
1. All habits → memory
2. Categories → memory and dropdowns
3. Date picker initialization
4. Display logged points for selected date
5. Display monthly progress

This is orchestrated in `checkIfUserIsLoggedIn()` (app.js:290-308).
