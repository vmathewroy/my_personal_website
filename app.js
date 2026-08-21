// ---------------------------------------------------------------------------
// Constants & configuration
// ---------------------------------------------------------------------------

const SUPABASE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/+esm';
const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
const CHART_DATALABELS_URL = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js';

const CONFIG_STORAGE_KEY = 'habitTrackerConfig';
const THEME_STORAGE_KEY = 'habitTrackerTheme';
const MAX_HABIT_QUANTITY = 99;
const RECENT_HABITS_LIMIT = 5;
const LOG_QUERY_PAGE_SIZE = 1000;
const STREAK_QUERY_ROW_LIMIT = 1000;
const MAX_CHART_LOAD_ATTEMPTS = 2;
// Streaks look back this many days from the selected date. The bounded query
// keeps a very dense quantity history from delaying the rest of the dashboard.
// If that cap is reached, streak values stay unavailable rather than reporting
// a shortened streak as exact; the small buffer lets normal histories reuse a
// complete cached range across nearby date changes.
const STREAK_WINDOW_DAYS = 120;
const STREAK_CACHE_BUFFER_DAYS = 14;

const CONFIG = {
    supabaseUrl: '',
    supabaseKey: '',
    redirectUrl: '',
    tables: {
        habitCategories: 'habit_categories',
        habitLog: 'habit_log',
        habits: 'habits'
    },
    dateFormat: 'en-CA'
};

// Categorical palette (validated light/dark steps). Slots are assigned to
// categories in a fixed, stable order — never re-shuffled between renders.
const CATEGORY_PALETTE = [
    { light: '#2a78d6', dark: '#3987e5' },
    { light: '#1baf7a', dark: '#199e70' },
    { light: '#eda100', dark: '#c98500' },
    { light: '#008300', dark: '#008300' },
    { light: '#4a3aa7', dark: '#9085e9' },
    { light: '#e34948', dark: '#e66767' },
    { light: '#e87ba4', dark: '#d55181' },
    { light: '#eb6834', dark: '#d95926' }
];

function createDataCache(userId = null) {
    return {
        userId,
        dayRows: null,
        dayKey: null,
        monthRows: null,
        monthKey: null,
        streakRows: null,
        streakKey: null,
        prevMonthPoints: null,
        monthRowsByKey: new Map(),
        monthPointRowsByKey: new Map(),
        streakWindow: null,
        streakLoadPromise: null,
        streakComplete: false,
        version: 0
    };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
    categories: {},            // category id -> name
    categorySlots: new Map(),  // category id -> palette slot index
    habits: [],                // all habits, loaded once after sign-in
    currentUser: null,
    selectedDate: todayKey(),
    categoryFilter: null,      // no category selected until the user picks one
    searchTerm: '',
    selectedHabitId: null,
    lastLogIds: [],            // ids of the most recent insert, for Undo
    lastLogDate: null,
    cache: createDataCache()
};

const charts = { day: null, trend: null, balance: null };
let supabase;
let toastTimer = null;
let supabaseModulePromise = null;
let chartLibraryPromise = null;
let chartLibraryRequested = false;
let chartObserver = null;
let chartLoadAttempts = 0;

// ---------------------------------------------------------------------------
// Date helpers (all keys are YYYY-MM-DD via the en-CA locale)
// ---------------------------------------------------------------------------

function todayKey() {
    return new Date().toLocaleDateString('en-CA');
}

function keyToDate(key) {
    return new Date(`${key}T00:00:00`);
}

function dateToKey(date) {
    return date.toLocaleDateString('en-CA');
}

function addDays(key, amount) {
    const date = keyToDate(key);
    date.setDate(date.getDate() + amount);
    return dateToKey(date);
}

function startOfWeekKey(key) {
    const date = keyToDate(key);
    const sinceMonday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - sinceMonday);
    return dateToKey(date);
}

function monthStartKey(key) {
    const date = keyToDate(key);
    return dateToKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEndKey(key) {
    const date = keyToDate(key);
    return dateToKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function monthCacheKey(key) {
    return key.slice(0, 7);
}

function formatKey(key, options) {
    return keyToDate(key).toLocaleDateString('en-US', options);
}

// ---------------------------------------------------------------------------
// Configuration storage
// ---------------------------------------------------------------------------

function loadConfig() {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!stored) return false;
    try {
        const parsed = JSON.parse(stored);
        CONFIG.supabaseUrl = parsed.supabaseUrl || '';
        CONFIG.supabaseKey = parsed.supabaseKey || '';
        CONFIG.redirectUrl = parsed.redirectUrl || '';
        return true;
    } catch (error) {
        console.error('Error parsing stored config:', error);
        return false;
    }
}

function saveConfig(supabaseUrl, supabaseKey, redirectUrl) {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ supabaseUrl, supabaseKey, redirectUrl }));
    CONFIG.supabaseUrl = supabaseUrl;
    CONFIG.supabaseKey = supabaseKey;
    CONFIG.redirectUrl = redirectUrl;
}

// ---------------------------------------------------------------------------
// Dialogs (setup, reconfigure, sign-in) — no native prompt()/alert()
// ---------------------------------------------------------------------------

function requestFormDialog({ eyebrow, title, description, fields = [], submitLabel, cancelLabel, note }) {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        const form = document.createElement('form');
        const header = document.createElement('div');
        const mark = document.createElement('span');
        const headingGroup = document.createElement('div');
        const eyebrowElement = document.createElement('p');
        const heading = document.createElement('h2');
        const copy = document.createElement('p');
        const fieldsContainer = document.createElement('div');
        const actions = document.createElement('div');
        const cancelButton = document.createElement('button');
        const submitButton = document.createElement('button');
        let settled = false;

        dialog.className = 'app-dialog';
        dialog.setAttribute('aria-labelledby', 'app_dialog_heading');
        form.className = 'dialog-form';
        header.className = 'dialog-header';
        mark.className = 'dialog-mark';
        mark.setAttribute('aria-hidden', 'true');
        headingGroup.className = 'dialog-heading-group';
        eyebrowElement.className = 'kicker';
        heading.id = 'app_dialog_heading';
        copy.className = 'dialog-description';
        fieldsContainer.className = 'dialog-fields';
        actions.className = 'dialog-actions';

        eyebrowElement.textContent = eyebrow;
        heading.textContent = title;
        copy.textContent = description;
        headingGroup.append(eyebrowElement, heading);
        header.append(mark, headingGroup);
        form.append(header, copy);

        fields.forEach(field => {
            const fieldGroup = document.createElement('div');
            const label = document.createElement('label');
            const input = document.createElement('input');

            fieldGroup.className = 'dialog-field';
            input.id = `dialog_${field.name}`;
            input.name = field.name;
            input.type = field.type || 'text';
            input.required = field.required !== false;
            input.value = field.value || '';
            input.placeholder = field.placeholder || '';
            if (field.autocomplete) input.autocomplete = field.autocomplete;
            label.htmlFor = input.id;
            label.textContent = field.label;
            fieldGroup.append(label, input);
            fieldsContainer.appendChild(fieldGroup);
        });

        if (fields.length) form.appendChild(fieldsContainer);

        if (note) {
            const noteElement = document.createElement('p');
            noteElement.className = 'dialog-note';
            noteElement.textContent = note;
            form.appendChild(noteElement);
        }

        cancelButton.type = 'button';
        cancelButton.className = 'dialog-button dialog-button--secondary';
        cancelButton.textContent = cancelLabel;
        submitButton.type = 'submit';
        submitButton.className = 'dialog-button dialog-button--primary';
        submitButton.textContent = submitLabel;
        actions.append(cancelButton, submitButton);
        form.appendChild(actions);
        dialog.appendChild(form);

        function finish(value) {
            if (settled) return;
            settled = true;
            if (dialog.open) dialog.close();
            dialog.remove();
            resolve(value);
        }

        cancelButton.addEventListener('click', () => finish(null));
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            finish(null);
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            const values = {};
            fields.forEach(field => {
                values[field.name] = form.elements.namedItem(field.name).value.trim();
            });
            finish(values);
        });

        document.body.appendChild(dialog);
        dialog.showModal();
    });
}

async function promptForConfig() {
    const values = await requestFormDialog({
        eyebrow: 'Private setup',
        title: 'Connect your habit data',
        description: 'Add the Supabase details for this tracker. They stay saved in this browser on this device.',
        fields: [
            {
                name: 'supabaseUrl',
                label: 'Supabase URL',
                type: 'url',
                placeholder: 'https://your-project.supabase.co',
                value: CONFIG.supabaseUrl,
                autocomplete: 'url'
            },
            {
                name: 'supabaseKey',
                label: 'Supabase anon / publishable key',
                type: 'password',
                placeholder: 'Paste your anon key',
                value: CONFIG.supabaseKey,
                autocomplete: 'off'
            },
            {
                name: 'redirectUrl',
                label: 'Login redirect URL',
                type: 'url',
                placeholder: 'https://your-site.example.com',
                value: CONFIG.redirectUrl,
                autocomplete: 'url'
            }
        ],
        submitLabel: 'Save setup',
        cancelLabel: 'Not now',
        note: 'Use only the browser-safe anon/publishable key here — never a service-role or secret key. The value is saved in this browser on this device.'
    });

    if (!values) return false;
    saveConfig(values.supabaseUrl, values.supabaseKey, values.redirectUrl);
    return true;
}

async function initializeConfig() {
    const hasConfig = loadConfig();
    if (!hasConfig || !CONFIG.supabaseUrl || !CONFIG.supabaseKey || !CONFIG.redirectUrl) {
        return await promptForConfig();
    }
    return true;
}

window.reconfigureApp = async function () {
    const confirmed = await requestFormDialog({
        eyebrow: 'Connection settings',
        title: 'Redo your setup?',
        description: 'You can replace the saved Supabase connection. The page will reload after the new details are saved.',
        submitLabel: 'Update setup',
        cancelLabel: 'Keep current setup'
    });

    if (!confirmed) return;
    if (await promptForConfig()) location.reload();
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function storedTheme() {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
        return null;
    }
}

function applyTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    if (persist) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch (error) {
            // Storage may be unavailable; the theme still applies for this visit.
        }
    }
    updateThemeToggle();
    rerenderFromCache();
}

function updateThemeToggle() {
    const toggle = document.getElementById('theme_toggle');
    if (!toggle) return;
    toggle.setAttribute(
        'aria-label',
        currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
    );
}

function initializeTheme() {
    updateThemeToggle();
    document.getElementById('theme_toggle').addEventListener('click', () => {
        applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (!storedTheme()) applyTheme(event.matches ? 'dark' : 'light', false);
    });
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function getThemeValue(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function setContainerMessage(container, message, type = 'empty') {
    if (!container) return;
    const messageElement = document.createElement(container.matches('ul, ol') ? 'li' : 'p');
    messageElement.className = `state-message${type === 'error' ? ' state-message--error' : ''}`;
    messageElement.textContent = message;
    container.replaceChildren(messageElement);
    container.setAttribute('aria-busy', 'false');

    if (type === 'error') {
        container.setAttribute('role', 'alert');
    } else {
        container.removeAttribute('role');
    }
}

function hideToast() {
    document.getElementById('app_toast')?.classList.remove('is-visible');
}

/**
 * Non-blocking feedback. Pass { action: { label, handler } } to render an
 * inline action button (used for Undo after logging).
 */
function showToast(message, options = {}) {
    const toast = document.getElementById('app_toast');
    if (!toast) return;

    window.clearTimeout(toastTimer);
    toast.replaceChildren();

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    toast.appendChild(text);

    if (options.action) {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'toast-action';
        actionButton.textContent = options.action.label;
        actionButton.addEventListener('click', () => {
            hideToast();
            options.action.handler();
        });
        toast.appendChild(actionButton);
    }

    toast.classList.toggle('is-error', options.type === 'error');
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(hideToast, options.action ? 6500 : 3600);
}

function renderFatalState(title, message) {
    const container = document.createElement('main');
    const heading = document.createElement('h1');
    const copy = document.createElement('p');

    container.className = 'fatal-state';
    heading.textContent = title;
    copy.textContent = message;
    container.append(heading, copy);
    document.body.replaceChildren(container);
}

// ---------------------------------------------------------------------------
// Category colors — fixed-order slot assignment from the validated palette
// ---------------------------------------------------------------------------

function assignCategorySlots() {
    const ids = Object.keys(state.categories)
        .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    state.categorySlots.clear();
    ids.forEach((id, index) => {
        state.categorySlots.set(String(id), index % CATEGORY_PALETTE.length);
    });
}

function getCategoryColor(categoryId) {
    const slot = state.categorySlots.get(String(categoryId)) ?? 0;
    const pair = CATEGORY_PALETTE[slot];
    return currentTheme() === 'dark' ? pair.dark : pair.light;
}

// ---------------------------------------------------------------------------
// Deferred third-party libraries
// ---------------------------------------------------------------------------

function preloadSupabaseModule() {
    if (!supabaseModulePromise) {
        supabaseModulePromise = import(SUPABASE_MODULE_URL);
    }
    return supabaseModulePromise;
}

function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Could not load ${src}`));
        document.head.appendChild(script);
    });
}

function loadChartLibrary() {
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        return Promise.resolve();
    }
    if (chartLibraryPromise) return chartLibraryPromise;

    chartLoadAttempts += 1;
    const chartLoad = typeof Chart === 'undefined'
        ? loadExternalScript(CHART_JS_URL)
        : Promise.resolve();
    chartLibraryPromise = chartLoad
        .then(() => typeof ChartDataLabels === 'undefined'
            ? loadExternalScript(CHART_DATALABELS_URL)
            : undefined)
        .then(() => {
            if (typeof Chart === 'undefined' || typeof ChartDataLabels === 'undefined') {
                throw new Error('Chart libraries loaded without their expected globals.');
            }
            // The data can arrive before the chart library. Re-render from the
            // cached rows once it is ready rather than delaying the dashboard.
            rerenderFromCache();
        })
        .catch(error => {
            chartLibraryPromise = null;
            chartLibraryRequested = false;
            if (chartLoadAttempts < MAX_CHART_LOAD_ATTEMPTS) {
                window.setTimeout(requestChartLibraryWhenVisible, 3000);
            }
            throw error;
        });

    return chartLibraryPromise;
}

function requestChartLibraryWhenVisible() {
    if (chartLibraryRequested || (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined')) return;

    const canvases = ['points_chart', 'trend_chart', 'progress_chart']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    if (!canvases.length) return;

    chartLibraryRequested = true;
    const beginLoading = () => {
        chartObserver?.disconnect();
        chartObserver = null;

        const load = () => {
            void loadChartLibrary().catch(error => {
                console.error('Error loading chart libraries:', error);
            });
        };

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(load, { timeout: 1200 });
        } else {
            window.setTimeout(load, 0);
        }
    };

    if ('IntersectionObserver' in window) {
        chartObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) beginLoading();
        }, { rootMargin: '240px 0px' });
        canvases.forEach(canvas => chartObserver.observe(canvas));
    } else {
        beginLoading();
    }
}

// ---------------------------------------------------------------------------
// Supabase client & auth
// ---------------------------------------------------------------------------

async function initializeSupabase() {
    if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
        console.error('Cannot initialize Supabase without URL and Key');
        return false;
    }
    // Imported on demand so the page shell still renders if the CDN is
    // slow or unreachable — the failure then surfaces as a clear message.
    try {
        const { createClient } = await preloadSupabaseModule();
        supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
        return true;
    } catch (error) {
        console.error('Error loading the Supabase library:', error);
        return false;
    }
}

function updateAuthButton() {
    const button = document.getElementById('auth_button');
    if (!button) return;
    button.hidden = false;
    button.textContent = state.currentUser ? 'Sign out' : 'Sign in';
}

async function enterSignedInState(user) {
    if (state.cache.userId !== user.id) resetDataCache(user.id);
    state.currentUser = user;
    const cache = state.cache;
    updateAuthButton();
    await Promise.all([loadCategories(cache), loadAllHabits(cache)]);
    if (state.cache !== cache || state.currentUser?.id !== user.id) return;

    assignCategorySlots();
    renderCategoryChips();
    renderHabitGrid();
    await refreshAllData({ background: true });
    requestChartLibraryWhenVisible();
}

function resetDataCache(userId = null) {
    state.cache = createDataCache(userId);
}

function scheduleSupplementaryRefresh(dateKey, options) {
    const refresh = () => {
        if (!state.currentUser || state.selectedDate !== dateKey) return;
        void Promise.all([
            refreshMonth(dateKey, options),
            refreshStreaks(dateKey, options)
        ]);
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(refresh, { timeout: 700 });
    } else {
        window.setTimeout(refresh, 0);
    }
}

/**
 * Make the selected day's activity usable first. Monthly analytics and streaks
 * are secondary, so they refresh during the browser's next idle opportunity.
 */
async function refreshAllData({ dateKey = state.selectedDate, force = false, background = true } = {}) {
    await refreshDay(dateKey, { force });

    const options = { force };
    if (background) {
        scheduleSupplementaryRefresh(dateKey, options);
        return;
    }

    await Promise.all([
        refreshMonth(dateKey, options),
        refreshStreaks(dateKey, options)
    ]);
}

function renderSignedOutStates() {
    setContainerMessage(document.getElementById('habit_grid'), 'Sign in to load your habits.');
    setContainerMessage(document.getElementById('logged_points_list'), "Sign in to see this day's activity.");
    setContainerMessage(document.getElementById('month_summary'), 'Sign in to see monthly progress.');
    setContainerMessage(document.getElementById('top_habits_list'), 'Sign in to see your most consistent habits.');
    document.getElementById('category_chips').replaceChildren();
    document.getElementById('recent_block').hidden = true;
    document.getElementById('total_points_badge').textContent = '0 pts';
    ['stat_points', 'stat_entries', 'stat_categories', 'stat_streak'].forEach(id => {
        document.getElementById(id).textContent = '—';
    });
    Object.keys(charts).forEach(key => {
        charts[key]?.destroy();
        charts[key] = null;
    });
}

async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        showToast(`Sign out didn't complete. ${error.message}`, 'error');
        return;
    }
    state.currentUser = null;
    state.habits = [];
    state.categories = {};
    state.selectedHabitId = null;
    state.lastLogIds = [];
    state.lastLogDate = null;
    resetDataCache();
    updateComposer();
    updateAuthButton();
    renderSignedOutStates();
    showToast('Signed out. See you tomorrow.');
}

async function promptSignIn() {
    const values = await requestFormDialog({
        eyebrow: 'Welcome back',
        title: 'Sign in to continue',
        description: 'Enter your email and we will send you a secure magic link to open your habit tracker.',
        fields: [
            {
                name: 'email',
                label: 'Email address',
                type: 'email',
                placeholder: 'you@example.com',
                autocomplete: 'email'
            }
        ],
        submitLabel: 'Send magic link',
        cancelLabel: 'Not now',
        note: 'No password needed. Your sign-in link will use the redirect URL saved during setup.'
    });

    if (values?.email) {
        await loginWithEmail(values.email);
    } else {
        renderSignedOutStates();
    }
}

async function loginWithEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
            emailRedirectTo: CONFIG.redirectUrl
        }
    });

    if (error) {
        showToast(`We couldn't send the login link. ${error.message}`, { type: 'error' });
    } else {
        showToast('Magic link sent. Check your email to finish signing in.');
        setContainerMessage(document.getElementById('habit_grid'), 'Check your email for the magic link, then return here to continue.');
    }
}

async function checkIfUserIsLoggedIn() {
    const { data: { session } } = await supabase.auth.getSession();

    // Catch sign-ins that complete after load (e.g. returning from a magic
    // link) and sign-outs from other tabs. Supabase work is deferred out of
    // the callback to avoid deadlocks inside onAuthStateChange.
    supabase.auth.onAuthStateChange((event, changedSession) => {
        if (event === 'SIGNED_IN' && changedSession?.user && !state.currentUser) {
            window.setTimeout(() => enterSignedInState(changedSession.user), 0);
        }
        if (event === 'SIGNED_OUT' && state.currentUser) {
            state.currentUser = null;
            state.habits = [];
            state.categories = {};
            state.selectedHabitId = null;
            state.lastLogIds = [];
            state.lastLogDate = null;
            resetDataCache();
            updateComposer();
            window.setTimeout(() => {
                updateAuthButton();
                renderSignedOutStates();
            }, 0);
        }
    });

    if (session?.user) {
        await enterSignedInState(session.user);
    } else {
        updateAuthButton();
        renderSignedOutStates();
        await promptSignIn();
    }
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadCategories(cache = state.cache) {
    const { data, error } = await supabase
        .from(CONFIG.tables.habitCategories)
        .select('id, category_name');

    if (error) {
        console.error('Error fetching categories:', error);
        return;
    }

    if (state.cache !== cache || state.currentUser?.id !== cache.userId) return;

    state.categories = {};
    (data || []).forEach(row => {
        state.categories[row.id] = row.category_name;
    });
}

async function loadAllHabits(cache = state.cache) {
    const { data, error } = await supabase
        .from(CONFIG.tables.habits)
        .select('id, name, category, default_points');

    if (error) {
        console.error('Error fetching habits:', error);
        return;
    }

    if (state.cache !== cache || state.currentUser?.id !== cache.userId) return;

    state.habits = data || [];
}

// ---------------------------------------------------------------------------
// Day selection: week strip, date labels, navigation
// ---------------------------------------------------------------------------

function renderWeekStrip() {
    const strip = document.getElementById('week_strip');
    const weekStart = startOfWeekKey(state.selectedDate);
    const today = todayKey();

    strip.replaceChildren();
    for (let offset = 0; offset < 7; offset++) {
        const key = addDays(weekStart, offset);
        const isSelected = key === state.selectedDate;
        const button = document.createElement('button');
        const dayName = document.createElement('span');
        const dayNumber = document.createElement('span');

        button.type = 'button';
        button.className = 'day-cell';
        if (isSelected) button.classList.add('is-selected');
        if (key === today) button.classList.add('is-today');
        button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        button.setAttribute('aria-label', formatKey(key, { weekday: 'long', month: 'long', day: 'numeric' }));

        dayName.className = 'day-cell-name';
        dayName.textContent = formatKey(key, { weekday: 'narrow' });
        dayNumber.className = 'day-cell-num';
        dayNumber.textContent = String(keyToDate(key).getDate());

        button.append(dayName, dayNumber);
        button.addEventListener('click', () => selectDate(key));
        strip.appendChild(button);
    }
}

function updateDayContext() {
    const key = state.selectedDate;
    const today = todayKey();
    const dayLabel = document.getElementById('selected_day_label');
    const daySub = document.getElementById('selected_day_sub');
    const dayHeading = document.getElementById('day_heading');
    const logTarget = document.getElementById('log_target_note');
    const monthLabel = formatKey(key, { month: 'long', year: 'numeric' });

    let relative = formatKey(key, { weekday: 'long' });
    if (key === today) relative = 'Today';
    if (key === addDays(today, -1)) relative = 'Yesterday';
    if (key === addDays(today, 1)) relative = 'Tomorrow';

    dayLabel.textContent = relative;
    daySub.textContent = formatKey(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    dayHeading.textContent = key === today ? "Today's activity" : `${formatKey(key, { weekday: 'long' })}'s activity`;
    logTarget.textContent = key === today
        ? 'Saving to today'
        : `Saving to ${formatKey(key, { month: 'short', day: 'numeric' })}`;
    document.getElementById('progress_period').textContent = monthLabel;
    document.getElementById('top_habits_period').textContent = monthLabel;
    document.getElementById('date_picker').value = key;
}

async function selectDate(key) {
    if (!key) return;
    state.selectedDate = key;
    renderWeekStrip();
    updateDayContext();

    if (!state.currentUser) return;

    clearActiveViewCache();
    showDateLoadingStates();
    document.getElementById('logged_points_list').setAttribute('aria-busy', 'true');
    document.getElementById('month_summary').setAttribute('aria-busy', 'true');
    document.getElementById('top_habits_list').setAttribute('aria-busy', 'true');
    await refreshAllData({ dateKey: key, background: true });
}

// ---------------------------------------------------------------------------
// Quick log: chips, habit grid, composer
// ---------------------------------------------------------------------------

function renderCategoryChips() {
    const container = document.getElementById('category_chips');
    const entries = Object.entries(state.categories)
        .sort((a, b) => a[1].localeCompare(b[1]));

    container.replaceChildren();
    if (!entries.length) return;

    entries.forEach(([id, name]) => {
        const chip = document.createElement('button');
        const dot = document.createElement('span');
        const isActive = state.categoryFilter !== null && String(state.categoryFilter) === String(id);

        chip.type = 'button';
        chip.className = 'chip';
        if (isActive) chip.classList.add('is-active');
        chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        dot.className = 'chip-dot';
        dot.style.setProperty('--category-color', getCategoryColor(id));
        chip.append(dot, document.createTextNode(name));
        chip.addEventListener('click', () => {
            // Tapping the active chip deselects it and empties the grid again.
            state.categoryFilter = isActive ? null : id;
            renderCategoryChips();
            renderHabitGrid();
        });
        container.appendChild(chip);
    });
}

/**
 * One-tap shortcuts for the habits logged most recently this month,
 * derived from the cached month rows — no extra query.
 */
function renderRecentHabits() {
    const block = document.getElementById('recent_block');
    const row = document.getElementById('recent_habits');
    const rows = state.cache.monthRows || [];

    if (!state.currentUser || !rows.length || !state.habits.length) {
        block.hidden = true;
        row.replaceChildren();
        return;
    }

    const lastLogged = new Map();
    const counts = new Map();
    rows.forEach(logRow => {
        const id = String(logRow.habit);
        counts.set(id, (counts.get(id) || 0) + 1);
        if (!lastLogged.has(id) || logRow.date > lastLogged.get(id)) {
            lastLogged.set(id, logRow.date);
        }
    });

    const buttons = [...lastLogged.keys()]
        .sort((a, b) => lastLogged.get(b).localeCompare(lastLogged.get(a)) || counts.get(b) - counts.get(a))
        .map(id => state.habits.find(habit => String(habit.id) === id))
        .filter(Boolean)
        .slice(0, RECENT_HABITS_LIMIT)
        .map(habit => {
            const isSelected = String(habit.id) === String(state.selectedHabitId);
            const chip = document.createElement('button');
            const dot = document.createElement('span');

            chip.type = 'button';
            chip.className = 'recent-chip';
            if (isSelected) chip.classList.add('is-selected');
            chip.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
            const points = Number(habit.default_points);
            chip.setAttribute('aria-label', `${habit.name}, ${points} ${points === 1 ? 'point' : 'points'}`);
            dot.className = 'chip-dot';
            dot.style.setProperty('--category-color', getCategoryColor(habit.category));
            chip.append(dot, document.createTextNode(habit.name));
            chip.addEventListener('click', () => {
                // Selecting a recent habit also selects its category, so the
                // grid opens to that category with the habit highlighted.
                if (!isSelected) {
                    state.categoryFilter = habit.category;
                    renderCategoryChips();
                }
                selectHabit(isSelected ? null : habit.id);
            });
            return chip;
        });

    if (!buttons.length) {
        block.hidden = true;
        row.replaceChildren();
        return;
    }

    block.hidden = false;
    row.replaceChildren(...buttons);
}

function renderHabitGrid() {
    const grid = document.getElementById('habit_grid');

    if (!state.habits.length) {
        setContainerMessage(grid, 'No habits yet. Add rows to your habits table to start logging.');
        return;
    }

    // The grid stays empty until the user narrows it down.
    const term = state.searchTerm.trim().toLowerCase();
    if (state.categoryFilter === null && !term) {
        setContainerMessage(grid, 'Pick a category or search to see your habits.');
        return;
    }

    let list = state.habits.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (state.categoryFilter !== null) {
        list = list.filter(habit => String(habit.category) === String(state.categoryFilter));
    }
    if (term) {
        list = list.filter(habit => habit.name.toLowerCase().includes(term));
    }

    if (!list.length) {
        setContainerMessage(grid, 'No habits match your filters.');
        return;
    }

    grid.replaceChildren();
    grid.setAttribute('aria-busy', 'false');
    grid.removeAttribute('role');

    list.forEach(habit => {
        const isSelected = String(habit.id) === String(state.selectedHabitId);
        const button = document.createElement('button');
        const name = document.createElement('span');
        const meta = document.createElement('span');

        button.type = 'button';
        button.className = 'habit-option';
        if (isSelected) button.classList.add('is-selected');
        button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        button.style.setProperty('--category-color', getCategoryColor(habit.category));

        name.className = 'habit-option-name';
        name.textContent = habit.name;
        meta.className = 'habit-option-meta';
        const points = Number(habit.default_points);
        const categoryName = state.categories[habit.category] || 'Uncategorized';
        meta.textContent = `${points} ${points === 1 ? 'pt' : 'pts'} · ${categoryName}`;
        button.setAttribute('aria-label', `${habit.name}, ${points} ${points === 1 ? 'point' : 'points'}, ${categoryName}`);

        button.append(name, meta);
        button.addEventListener('click', () => {
            selectHabit(isSelected ? null : habit.id);
        });
        grid.appendChild(button);
    });
}

function selectHabit(habitId) {
    state.selectedHabitId = habitId;
    setHabitQuantity(1);
    renderHabitGrid();
    renderRecentHabits();
    updateComposer();
}

function getSelectedHabit() {
    return state.habits.find(habit => String(habit.id) === String(state.selectedHabitId)) || null;
}

function updateComposer() {
    const composer = document.getElementById('log_composer');
    const habit = getSelectedHabit();

    composer.hidden = !habit;
    if (!habit) return;

    const points = Number(habit.default_points);
    document.getElementById('composer_habit_name').textContent = habit.name;
    document.getElementById('composer_meta').textContent = `+${points} ${points === 1 ? 'pt' : 'pts'} each`;
    updateRecordButtonLabel();
}

function getHabitQuantity() {
    const quantityInput = document.getElementById('habit_quantity');
    const quantity = Number(quantityInput.value);

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
        quantityInput.value = '1';
        return 1;
    }
    if (quantity > MAX_HABIT_QUANTITY) {
        quantityInput.value = String(MAX_HABIT_QUANTITY);
        return MAX_HABIT_QUANTITY;
    }
    return quantity;
}

function setHabitQuantity(quantity) {
    const quantityInput = document.getElementById('habit_quantity');
    const safeQuantity = Number.isSafeInteger(quantity) && quantity > 0
        ? Math.min(quantity, MAX_HABIT_QUANTITY)
        : 1;

    quantityInput.value = String(safeQuantity);
    updateRecordButtonLabel(safeQuantity);
}

function updateRecordButtonLabel(quantity = getHabitQuantity()) {
    const recordButton = document.getElementById('record_habit_button');
    recordButton.textContent = quantity === 1 ? 'Log habit' : `Log ×${quantity}`;
}

function setComposerBusy(busy, quantity) {
    const recordButton = document.getElementById('record_habit_button');
    recordButton.disabled = busy;
    document.getElementById('habit_quantity').disabled = busy;
    document.getElementById('decrease_quantity_button').disabled = busy;
    document.getElementById('increase_quantity_button').disabled = busy;
    if (busy) {
        recordButton.setAttribute('aria-busy', 'true');
        recordButton.textContent = quantity === 1 ? 'Logging…' : `Logging ×${quantity}…`;
    } else {
        recordButton.removeAttribute('aria-busy');
        updateRecordButtonLabel();
    }
}

// ---------------------------------------------------------------------------
// Logging & undo
// ---------------------------------------------------------------------------

async function onRecordHabitClicked() {
    const habit = getSelectedHabit();

    if (!habit) {
        showToast('Choose a habit before logging it.', { type: 'error' });
        return;
    }

    const quantity = getHabitQuantity();
    const logDate = state.selectedDate;
    const cache = state.cache;
    const userId = state.currentUser?.id;
    setComposerBusy(true, quantity);

    try {
        // Always log to the selected date so past days can be backfilled.
        const logEntries = Array.from({ length: quantity }, () => ({
            date: logDate,
            habit: habit.id
        }));
        const { data, error } = await supabase
            .from(CONFIG.tables.habitLog)
            .insert(logEntries)
            .select();

        if (error) {
            console.error('Error recording habit:', error);
            if (isCurrentUserCache(cache, userId)) {
                showToast(`We couldn't log that habit. ${error.message}`, { type: 'error' });
            }
            return;
        }

        if (!isCurrentUserCache(cache, userId)) return;

        state.lastLogIds = (data || []).map(row => row.id).filter(id => id !== undefined && id !== null);
        state.lastLogDate = logDate;
        setHabitQuantity(1);
        invalidateDataForDate(logDate);
        const activeDate = state.selectedDate;
        await refreshAllData({
            dateKey: activeDate,
            background: true,
            force: activeDate === logDate
        });

        const totalPoints = Number(habit.default_points) * quantity;
        const label = quantity === 1 ? habit.name : `${habit.name} ×${quantity}`;
        const toastOptions = state.lastLogIds.length
            ? { action: { label: 'Undo', handler: undoLastLog } }
            : {};
        showToast(`${label} logged · +${totalPoints} ${totalPoints === 1 ? 'pt' : 'pts'}`, toastOptions);
    } catch (error) {
        console.error('Unexpected error:', error);
        if (isCurrentUserCache(cache, userId)) {
            showToast('Something unexpected happened. Please try again.', { type: 'error' });
        }
    } finally {
        if (isCurrentUserCache(cache, userId)) setComposerBusy(false, quantity);
    }
}

async function undoLastLog() {
    const ids = [...state.lastLogIds];
    if (!ids.length) return;
    const logDate = state.lastLogDate;
    const cache = state.cache;
    const userId = state.currentUser?.id;
    state.lastLogIds = [];
    state.lastLogDate = null;

    const { error } = await supabase
        .from(CONFIG.tables.habitLog)
        .delete()
        .in('id', ids);

    if (!isCurrentUserCache(cache, userId)) return;

    if (error) {
        state.lastLogIds = ids;
        state.lastLogDate = logDate;
        console.error('Error undoing log:', error);
        showToast(`We couldn't undo that entry. ${error.message}`, { type: 'error' });
        return;
    }

    if (logDate) {
        invalidateDataForDate(logDate);
        const activeDate = state.selectedDate;
        await refreshAllData({
            dateKey: activeDate,
            background: true,
            force: activeDate === logDate
        });
    }
    showToast('Entry removed.');
}

/** Remove a single logged entry from the selected day's activity list. */
async function deleteLogEntry(entryId, habitName, points, dateKey) {
    const cache = state.cache;
    const userId = state.currentUser?.id;
    const { error } = await supabase
        .from(CONFIG.tables.habitLog)
        .delete()
        .eq('id', entryId);

    if (!isCurrentUserCache(cache, userId)) return;

    if (error) {
        console.error('Error deleting entry:', error);
        showToast(`We couldn't remove that entry. ${error.message}`, { type: 'error' });
        return;
    }

    // Keep Undo honest if this entry was part of the last logged batch.
    state.lastLogIds = state.lastLogIds.filter(id => id !== entryId);
    if (!state.lastLogIds.length) state.lastLogDate = null;
    invalidateDataForDate(dateKey);
    const activeDate = state.selectedDate;
    await refreshAllData({
        dateKey: activeDate,
        background: true,
        force: activeDate === dateKey
    });
    showToast(`${habitName} entry removed · −${points} ${points === 1 ? 'pt' : 'pts'}`);
}

// ---------------------------------------------------------------------------
// Day view: stats, activity list, category chart
// ---------------------------------------------------------------------------

function isCurrentUserCache(cache, userId = cache.userId) {
    return state.cache === cache
        && cache.userId === userId
        && state.currentUser?.id === userId;
}

function isActiveDataRequest(dateKey, cache, cacheVersion) {
    return isCurrentUserCache(cache)
        && state.selectedDate === dateKey
        && cache.version === cacheVersion;
}

function cachedMonthRows(dateKey) {
    return state.cache.monthRowsByKey.get(monthCacheKey(dateKey))?.rows || null;
}

function cachedDayRows(dateKey) {
    const rows = cachedMonthRows(dateKey);
    return rows ? rows.filter(row => row.date === dateKey) : null;
}

function invalidateDataForDate(dateKey) {
    const cache = state.cache;
    cache.version += 1;
    cache.monthRowsByKey.delete(monthCacheKey(dateKey));
    cache.monthPointRowsByKey.delete(monthCacheKey(dateKey));
    cache.streakWindow = null;
    cache.streakLoadPromise = null;
    cache.streakComplete = false;

    if (state.selectedDate === dateKey) {
        cache.dayRows = null;
        cache.dayKey = null;
        cache.monthRows = null;
        cache.monthKey = null;
        cache.prevMonthPoints = null;
        cache.streakRows = null;
        cache.streakKey = null;
        cache.streakComplete = false;
    }
}

function clearActiveViewCache() {
    const cache = state.cache;
    cache.dayRows = null;
    cache.dayKey = null;
    cache.monthRows = null;
    cache.monthKey = null;
    cache.prevMonthPoints = null;
    cache.streakRows = null;
    cache.streakKey = null;
    cache.streakComplete = false;

    Object.keys(charts).forEach(key => {
        charts[key]?.destroy();
        charts[key] = null;
    });
}

function showDateLoadingStates() {
    setContainerMessage(document.getElementById('logged_points_list'), "Loading the day's activity…");
    setContainerMessage(document.getElementById('month_summary'), 'Loading monthly progress…');
    setContainerMessage(document.getElementById('top_habits_list'), 'Loading top habits…');
    document.getElementById('total_points_badge').textContent = '—';
    ['stat_points', 'stat_entries', 'stat_categories', 'stat_streak'].forEach(id => {
        document.getElementById(id).textContent = '—';
    });
}

async function fetchAllHabitLogPages(createQuery) {
    const rows = [];

    for (let offset = 0; ; offset += LOG_QUERY_PAGE_SIZE) {
        const { data, error } = await createQuery()
            .range(offset, offset + LOG_QUERY_PAGE_SIZE - 1);
        if (error) throw error;

        const page = data || [];
        rows.push(...page);
        if (page.length < LOG_QUERY_PAGE_SIZE) return rows;
    }
}

async function getCalendarMonthRows(dateKey, { force = false } = {}) {
    const cache = state.cache;
    const key = monthCacheKey(dateKey);
    const cached = cache.monthRowsByKey.get(key);
    if (!force && cached?.rows) return cached.rows;
    if (!force && cached?.promise) return cached.promise;

    const userId = cache.userId;
    const entry = { rows: null, promise: null };
    entry.promise = fetchAllHabitLogPages(() => supabase
        .from(CONFIG.tables.habitLog)
        .select(`
            id,
            date,
            habit,
            habits (
                name,
                default_points,
                category
            )
        `)
        .gte('date', monthStartKey(dateKey))
        .lte('date', monthEndKey(dateKey))
        .order('date', { ascending: true })
        .order('id', { ascending: true }))
        .then(rows => {
            if (state.cache === cache
                && cache.userId === userId
                && cache.monthRowsByKey.get(key) === entry) {
                entry.rows = rows;
            }
            return rows;
        })
        .catch(error => {
            if (state.cache === cache && cache.monthRowsByKey.get(key) === entry) {
                cache.monthRowsByKey.delete(key);
            }
            throw error;
        });

    cache.monthRowsByKey.set(key, entry);
    return entry.promise;
}

async function getCalendarMonthPointRows(dateKey) {
    const cache = state.cache;
    const key = monthCacheKey(dateKey);
    const cached = cache.monthPointRowsByKey.get(key);
    if (cached?.rows) return cached.rows;
    if (cached?.promise) return cached.promise;

    const userId = cache.userId;
    const entry = { rows: null, promise: null };
    entry.promise = fetchAllHabitLogPages(() => supabase
        .from(CONFIG.tables.habitLog)
        .select('date, habits ( default_points )')
        .gte('date', monthStartKey(dateKey))
        .lte('date', monthEndKey(dateKey))
        .order('date', { ascending: true })
        .order('id', { ascending: true }))
        .then(rows => {
            if (state.cache === cache
                && cache.userId === userId
                && cache.monthPointRowsByKey.get(key) === entry) {
                entry.rows = rows;
            }
            return rows;
        })
        .catch(error => {
            if (state.cache === cache && cache.monthPointRowsByKey.get(key) === entry) {
                cache.monthPointRowsByKey.delete(key);
            }
            throw error;
        });

    cache.monthPointRowsByKey.set(key, entry);
    return entry.promise;
}

async function refreshDay(dateKey = state.selectedDate, { force = false } = {}) {
    const cache = state.cache;
    const cacheVersion = cache.version;
    const list = document.getElementById('logged_points_list');
    const rowsFromMonthCache = force ? null : cachedDayRows(dateKey);

    if (rowsFromMonthCache) {
        if (isActiveDataRequest(dateKey, cache, cacheVersion)) {
            cache.dayRows = rowsFromMonthCache;
            cache.dayKey = dateKey;
            renderDay();
        }
        return rowsFromMonthCache;
    }

    let rows;
    try {
        rows = await fetchAllHabitLogPages(() => supabase
            .from(CONFIG.tables.habitLog)
            .select(`
                id,
                date,
                habits (
                    name,
                    default_points,
                    category
                )
            `)
            .eq('date', dateKey)
            .order('id', { ascending: true }));
    } catch (error) {
        console.error('Error fetching data:', error);
        if (isActiveDataRequest(dateKey, cache, cacheVersion)) {
            setContainerMessage(list, `We couldn't load this day's activity. ${error.message}`, 'error');
        }
        return null;
    }

    if (isActiveDataRequest(dateKey, cache, cacheVersion)) {
        cache.dayRows = rows;
        cache.dayKey = dateKey;
        renderDay();
    }
    return rows;
}

function renderDay() {
    const rows = state.cache.dayRows || [];
    const renderedDateKey = state.selectedDate;
    const list = document.getElementById('logged_points_list');
    const badge = document.getElementById('total_points_badge');

    // Group by category, aggregating repeated habits into counts.
    const byCategory = {};
    let totalPoints = 0;

    rows.forEach(row => {
        const categoryId = row.habits.category;
        const habitName = row.habits.name;
        const points = row.habits.default_points;

        if (!byCategory[categoryId]) {
            byCategory[categoryId] = { totalPoints: 0, habits: {} };
        }
        if (!byCategory[categoryId].habits[habitName]) {
            byCategory[categoryId].habits[habitName] = { count: 0, totalPoints: 0, pointsPerEntry: points, ids: [] };
        }
        const entry = byCategory[categoryId].habits[habitName];
        entry.count += 1;
        entry.totalPoints += points;
        if (row.id !== undefined && row.id !== null) entry.ids.push(row.id);
        byCategory[categoryId].totalPoints += points;
        totalPoints += points;
    });

    badge.textContent = `${totalPoints} ${totalPoints === 1 ? 'pt' : 'pts'}`;
    document.getElementById('stat_points').textContent = String(totalPoints);
    document.getElementById('stat_entries').textContent = String(rows.length);
    document.getElementById('stat_categories').textContent = String(Object.keys(byCategory).length);

    if (rows.length) {
        list.replaceChildren();
        list.removeAttribute('role');
        list.setAttribute('aria-busy', 'false');

        Object.entries(byCategory)
            .sort((a, b) => b[1].totalPoints - a[1].totalPoints)
            .forEach(([categoryId, categoryData]) => {
                const item = document.createElement('li');
                const summary = document.createElement('div');
                const name = document.createElement('span');
                const points = document.createElement('span');
                const habitsList = document.createElement('ul');

                item.className = 'activity-group';
                item.style.setProperty('--category-color', getCategoryColor(categoryId));
                summary.className = 'category-summary';
                name.className = 'category-name';
                points.className = 'category-points';
                name.textContent = state.categories[categoryId] || 'Uncategorized';
                points.textContent = `${categoryData.totalPoints} ${categoryData.totalPoints === 1 ? 'pt' : 'pts'}`;
                summary.append(name, points);
                item.appendChild(summary);

                Object.entries(categoryData.habits)
                    .sort((a, b) => b[1].count - a[1].count)
                    .forEach(([habitName, habitData]) => {
                        const habitItem = document.createElement('li');
                        const habitLabel = document.createElement('span');
                        const habitPoints = document.createElement('span');

                        habitLabel.className = 'habit-name-label';
                        habitPoints.className = 'habit-points-label';
                        habitLabel.textContent = habitData.count > 1 ? `${habitName} (${habitData.count}×)` : habitName;
                        habitPoints.textContent = `${habitData.totalPoints} ${habitData.totalPoints === 1 ? 'pt' : 'pts'}`;
                        habitItem.append(habitLabel, habitPoints);

                        if (habitData.ids.length) {
                            const removeButton = document.createElement('button');
                            removeButton.type = 'button';
                            removeButton.className = 'entry-delete';
                            removeButton.textContent = '×';
                            removeButton.setAttribute('aria-label', `Remove one ${habitName} entry from this day`);
                            removeButton.addEventListener('click', () => {
                                deleteLogEntry(
                                    habitData.ids[habitData.ids.length - 1],
                                    habitName,
                                    habitData.pointsPerEntry,
                                    renderedDateKey
                                );
                            });
                            habitItem.appendChild(removeButton);
                        }
                        habitsList.appendChild(habitItem);
                    });

                item.appendChild(habitsList);
                list.appendChild(item);
            });
    } else {
        const today = todayKey();
        const message = state.selectedDate === today
            ? 'Nothing logged yet today. Your next small win starts here.'
            : `Nothing was logged on ${formatKey(state.selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}.`;
        setContainerMessage(list, message);
    }

    const categoryPoints = {};
    Object.keys(byCategory).forEach(categoryId => {
        categoryPoints[categoryId] = byCategory[categoryId].totalPoints;
    });
    renderCategoryBarChart('day', 'points_chart', 'points_chart_description', categoryPoints);
}

// ---------------------------------------------------------------------------
// Month view: summary metric, daily trend, category balance, top habits
// ---------------------------------------------------------------------------

/**
 * The comparison window is the same slice of the previous month
 * (1st → same day-of-month, clamped to that month's length).
 */
function previousMonthRange(key) {
    const date = keyToDate(key);
    const start = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const daysInPrevMonth = new Date(date.getFullYear(), date.getMonth(), 0).getDate();
    const end = new Date(date.getFullYear(), date.getMonth() - 1, Math.min(date.getDate(), daysInPrevMonth));
    return { start: dateToKey(start), end: dateToKey(end) };
}

async function refreshMonth(dateKey = state.selectedDate, { force = false } = {}) {
    const summary = document.getElementById('month_summary');
    const prevRange = previousMonthRange(dateKey);
    const cache = state.cache;
    const cacheVersion = cache.version;
    const [monthResult, prevResult] = await Promise.allSettled([
        getCalendarMonthRows(dateKey, { force }),
        getCalendarMonthPointRows(prevRange.start)
    ]);

    if (!isActiveDataRequest(dateKey, cache, cacheVersion)) return;

    if (monthResult.status === 'rejected') {
        console.error('Error fetching progress data:', monthResult.reason);
        setContainerMessage(summary, `We couldn't load monthly progress. ${monthResult.reason.message}`, 'error');
        setContainerMessage(document.getElementById('top_habits_list'), `We couldn't load your top habits. ${monthResult.reason.message}`, 'error');
        return;
    }

    const rows = monthResult.value.filter(row => row.date <= dateKey);
    cache.monthRows = rows;
    cache.monthKey = dateKey;

    // The comparison is decorative; a failure here shouldn't block the view.
    if (prevResult.status === 'rejected') {
        console.error('Error fetching previous month data:', prevResult.reason);
        cache.prevMonthPoints = null;
    } else {
        cache.prevMonthPoints = prevResult.value
            .filter(row => row.date <= prevRange.end)
            .reduce((sum, row) => sum + row.habits.default_points, 0);
    }

    renderMonth();
}

function renderMonth() {
    const rows = state.cache.monthRows || [];
    const summary = document.getElementById('month_summary');
    const selected = keyToDate(state.selectedDate);
    const dayOfMonth = selected.getDate();
    const monthName = formatKey(state.selectedDate, { month: 'long' });

    let totalPoints = 0;
    const categoryPoints = {};
    const dailyPoints = new Array(dayOfMonth).fill(0);

    rows.forEach(row => {
        const points = row.habits.default_points;
        const categoryId = row.habits.category;
        totalPoints += points;
        categoryPoints[categoryId] = (categoryPoints[categoryId] || 0) + points;

        const day = keyToDate(row.date).getDate();
        if (day >= 1 && day <= dayOfMonth) {
            dailyPoints[day - 1] += points;
        }
    });

    // Summary metric
    const metricCopy = document.createElement('div');
    const metricLabel = document.createElement('span');
    const valueRow = document.createElement('div');
    const metricValue = document.createElement('strong');
    const metricUnit = document.createElement('span');
    const dateRange = document.createElement('p');

    metricCopy.className = 'metric-copy';
    metricLabel.className = 'metric-label';
    valueRow.className = 'metric-value-row';
    metricValue.className = 'total-points';
    metricUnit.className = 'metric-unit';
    dateRange.className = 'date-range';

    metricLabel.textContent = 'Points earned';
    metricValue.textContent = String(totalPoints);
    metricUnit.textContent = totalPoints === 1 ? 'pt' : 'pts';
    dateRange.textContent = dayOfMonth === 1
        ? `${monthName} 1 — the month starts here.`
        : `${monthName} 1–${dayOfMonth}, including the active day.`;

    valueRow.append(metricValue, metricUnit);
    metricCopy.append(metricLabel, valueRow);

    // Month-over-month: same slice of the previous month.
    if (state.cache.prevMonthPoints !== null) {
        const previousPoints = state.cache.prevMonthPoints;
        const delta = totalPoints - previousPoints;
        const prevRange = previousMonthRange(state.selectedDate);
        const prevMonthName = formatKey(prevRange.start, { month: 'long' });
        const prevEndDay = keyToDate(prevRange.end).getDate();
        const compare = document.createElement('p');

        compare.className = 'metric-compare';
        const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '•';
        const deltaLabel = delta === 0 ? 'even with' : `${delta > 0 ? '+' : ''}${delta} vs`;
        compare.textContent = `${arrow} ${deltaLabel} ${prevMonthName} 1–${prevEndDay} (${previousPoints} pts)`;
        metricCopy.appendChild(compare);
    }

    summary.replaceChildren(metricCopy, dateRange);
    summary.removeAttribute('role');
    summary.setAttribute('aria-busy', 'false');

    renderTrendChart(dailyPoints);
    renderCategoryBarChart('balance', 'progress_chart', 'progress_chart_description', categoryPoints);
    renderTopHabits(rows);
    renderRecentHabits();
}

function renderTopHabits(rows) {
    const container = document.getElementById('top_habits_list');
    const counts = {};

    rows.forEach(row => {
        const habitId = row.habit;
        if (!counts[habitId]) {
            counts[habitId] = { id: habitId, name: row.habits.name, category: row.habits.category, count: 0 };
        }
        counts[habitId].count += 1;
    });

    const ranked = Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    if (!ranked.length) {
        setContainerMessage(container, 'No streak leaders yet. Every check-in can take the first spot.');
        return;
    }

    const maxCount = ranked[0].count;
    const rankedList = document.createElement('ol');
    const streaks = getStreakData();

    ranked.forEach(entry => {
        const item = document.createElement('li');
        const copy = document.createElement('div');
        const name = document.createElement('span');
        const count = document.createElement('span');
        const bar = document.createElement('span');
        const barFill = document.createElement('span');

        item.style.setProperty('--category-color', getCategoryColor(entry.category));
        copy.className = 'top-copy';
        name.className = 'habit-name';
        count.className = 'habit-count';
        bar.className = 'habit-bar';
        bar.setAttribute('aria-hidden', 'true');
        barFill.className = 'habit-bar-fill';
        barFill.style.width = `${Math.max(6, Math.round((entry.count / maxCount) * 100))}%`;

        name.textContent = entry.name;
        count.textContent = `${entry.count} ${entry.count === 1 ? 'time' : 'times'}`;
        copy.append(name, count);

        const habitStreak = streaks?.habitStreaks.get(String(entry.id)) || 0;
        if (habitStreak >= 2) {
            const streakLabel = document.createElement('span');
            streakLabel.className = 'habit-streak';
            streakLabel.textContent = `${habitStreak}-day streak`;
            copy.appendChild(streakLabel);
        }

        bar.appendChild(barFill);
        item.append(copy, bar);
        rankedList.appendChild(item);
    });

    container.replaceChildren(rankedList);
    container.removeAttribute('role');
    container.setAttribute('aria-busy', 'false');
}

// ---------------------------------------------------------------------------
// Streaks (daily logging streak + per-habit streaks)
// ---------------------------------------------------------------------------

function streakWindowCovers(window, startDate, endDate) {
    return window && window.start <= startDate && window.end >= endDate;
}

async function fetchStreakRows(startDate, endDate) {
    const { data, error } = await supabase
        .from(CONFIG.tables.habitLog)
        .select('date, habit')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .limit(STREAK_QUERY_ROW_LIMIT);

    if (error) throw error;
    const rows = data || [];
    return {
        rows,
        // A response that exactly fills the cap may be truncated. Treat it as
        // incomplete so we never present a shorter streak as a real one.
        complete: rows.length < STREAK_QUERY_ROW_LIMIT
    };
}

async function getStreakWindowRows(startDate, endDate, { force = false } = {}) {
    const cache = state.cache;
    if (force) cache.streakWindow = null;
    if (streakWindowCovers(cache.streakWindow, startDate, endDate)) {
        return { rows: cache.streakWindow.rows, complete: true };
    }

    // A quick succession of date changes shares one load, then checks whether
    // its own requested window is covered before issuing another query.
    if (cache.streakLoadPromise) {
        await cache.streakLoadPromise;
        return getStreakWindowRows(startDate, endDate, { force: false });
    }

    const cacheVersion = cache.version;
    const userId = cache.userId;
    const existingWindow = cache.streakWindow;
    const ranges = [];

    if (!existingWindow) {
        ranges.push({ start: startDate, end: endDate });
    } else {
        if (startDate < existingWindow.start) {
            ranges.push({ start: startDate, end: addDays(existingWindow.start, -1) });
        }
        if (endDate > existingWindow.end) {
            ranges.push({ start: addDays(existingWindow.end, 1), end: endDate });
        }
    }

    const loadPromise = Promise.all(ranges.map(range => fetchStreakRows(range.start, range.end)))
        .then(results => {
            const rows = (existingWindow?.rows || []).concat(...results.map(result => result.rows))
                .sort((a, b) => b.date.localeCompare(a.date));
            const complete = results.every(result => result.complete);

            if (complete
                && state.cache === cache
                && cache.userId === userId
                && cache.version === cacheVersion) {
                cache.streakWindow = {
                    start: existingWindow ? (startDate < existingWindow.start ? startDate : existingWindow.start) : startDate,
                    end: existingWindow ? (endDate > existingWindow.end ? endDate : existingWindow.end) : endDate,
                    rows
                };
            }
            return { rows, complete };
        });

    cache.streakLoadPromise = loadPromise;
    try {
        return await loadPromise;
    } finally {
        if (state.cache.streakLoadPromise === loadPromise) {
            state.cache.streakLoadPromise = null;
        }
    }
}

async function refreshStreaks(dateKey = state.selectedDate, { force = false } = {}) {
    const cache = state.cache;
    const cacheVersion = cache.version;
    const startDate = addDays(dateKey, -STREAK_WINDOW_DAYS);
    const bufferedStart = addDays(startDate, -STREAK_CACHE_BUFFER_DAYS);
    const bufferedEnd = addDays(dateKey, STREAK_CACHE_BUFFER_DAYS);

    try {
        const streakResult = await getStreakWindowRows(bufferedStart, bufferedEnd, { force });
        if (!isActiveDataRequest(dateKey, cache, cacheVersion)) return;

        cache.streakRows = streakResult.rows.filter(row => row.date >= startDate && row.date <= dateKey);
        cache.streakKey = dateKey;
        cache.streakComplete = streakResult.complete;
        renderStreaks();
    } catch (error) {
        // Streaks are supplementary; leave the tile blank rather than failing.
        console.error('Error fetching streak data:', error);
        if (isActiveDataRequest(dateKey, cache, cacheVersion)) {
            cache.streakRows = null;
            cache.streakKey = dateKey;
            cache.streakComplete = false;
            renderStreaks();
        }
    }
}

/**
 * Streaks count consecutive days ending at the selected date. A day with no
 * logs yet doesn't break the streak until it is over: if the selected date
 * itself is empty, counting starts from the day before.
 */
function getStreakData() {
    const rows = state.cache.streakRows;
    if (!rows || !state.cache.streakComplete || state.cache.streakKey !== state.selectedDate) return null;

    const allDates = new Set();
    const datesByHabit = new Map();
    rows.forEach(row => {
        allDates.add(row.date);
        const habitId = String(row.habit);
        if (!datesByHabit.has(habitId)) datesByHabit.set(habitId, new Set());
        datesByHabit.get(habitId).add(row.date);
    });

    const streakEndingAtSelected = dates => {
        let cursor = state.selectedDate;
        if (!dates.has(cursor)) cursor = addDays(cursor, -1);
        let streak = 0;
        while (dates.has(cursor)) {
            streak += 1;
            cursor = addDays(cursor, -1);
        }
        return streak;
    };

    const habitStreaks = new Map();
    datesByHabit.forEach((dates, habitId) => {
        habitStreaks.set(habitId, streakEndingAtSelected(dates));
    });

    return { daily: streakEndingAtSelected(allDates), habitStreaks };
}

function renderStreaks() {
    const tile = document.getElementById('stat_streak');
    const streaks = getStreakData();
    tile.textContent = streaks ? String(streaks.daily) : '–';

    // Per-habit streaks live on the Most Consistent list; re-render it now
    // that streak data is available (order-independent with refreshMonth).
    if (state.cache.monthRows && state.cache.monthKey === state.selectedDate) {
        renderTopHabits(state.cache.monthRows);
    }
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

function chartChrome() {
    return {
        tick: getThemeValue('--chart-tick', '#8b8377'),
        grid: getThemeValue('--chart-grid', '#e7e2d8'),
        ink: getThemeValue('--text-primary', '#1d1a16'),
        secondary: getThemeValue('--text-secondary', '#5d574d'),
        surface: getThemeValue('--surface', '#ffffff'),
        border: getThemeValue('--border-strong', '#d5ccbc'),
        accent: getThemeValue('--accent', '#bc3f11'),
        font: getThemeValue('--font-body', 'sans-serif')
    };
}

function themedTooltip(chrome) {
    return {
        backgroundColor: chrome.surface,
        borderColor: chrome.border,
        borderWidth: 1,
        padding: 10,
        displayColors: false,
        titleColor: chrome.ink,
        bodyColor: chrome.secondary,
        titleFont: { family: chrome.font, size: 12, weight: 600 },
        bodyFont: { family: chrome.font, size: 12 }
    };
}

function sizeCategoryChart(canvas, categoryCount, isCompact) {
    const wrapper = canvas.closest('.chart-canvas');
    if (!wrapper) return;
    const rowHeight = isCompact ? 34 : 36;
    wrapper.style.height = `${Math.max(190, (categoryCount * rowHeight) + 46)}px`;
}

/**
 * Horizontal category bars, shared by the daily and monthly views.
 * Shows every category (zeros included), sorted by points descending.
 */
function renderCategoryBarChart(chartKey, canvasId, descriptionId, categoryPoints) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined' || typeof ChartDataLabels === 'undefined') return;

    const entries = Object.keys(state.categories)
        .map(categoryId => [categoryId, categoryPoints[categoryId] || 0])
        .sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([categoryId]) => state.categories[categoryId]);
    const values = entries.map(([, points]) => points);
    const colors = entries.map(([categoryId]) => getCategoryColor(categoryId));

    const description = document.getElementById(descriptionId);
    if (description) {
        description.textContent = labels.length
            ? labels.map((label, index) => `${label}: ${values[index]} ${values[index] === 1 ? 'point' : 'points'}`).join('. ')
            : 'No habit categories are available yet.';
    }

    const chrome = chartChrome();
    const isCompact = window.matchMedia('(max-width: 640px)').matches;
    sizeCategoryChart(canvas, labels.length, isCompact);

    charts[chartKey]?.destroy();
    charts[chartKey] = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 0,
                borderRadius: 4,
                borderSkipped: 'start',
                maxBarThickness: 18,
                categoryPercentage: 0.72
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: prefersReducedMotion() ? 0 : 400 },
            layout: { padding: { right: isCompact ? 28 : 36 } },
            scales: {
                x: {
                    beginAtZero: true,
                    grace: '8%',
                    ticks: {
                        precision: 0,
                        color: chrome.tick,
                        padding: 6,
                        font: { family: chrome.font, size: 11 }
                    },
                    border: { display: false },
                    grid: { color: chrome.grid, drawTicks: false }
                },
                y: {
                    ticks: {
                        color: chrome.secondary,
                        autoSkip: false,
                        padding: 8,
                        font: { family: chrome.font, size: isCompact ? 11 : 12, weight: 500 },
                        callback: function (value) {
                            const label = this.getLabelForValue(value);
                            const maxLength = isCompact ? 12 : 18;
                            return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
                        }
                    },
                    border: { display: false },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...themedTooltip(chrome),
                    callbacks: {
                        label: context => {
                            const points = context.parsed.x;
                            return points === 1 ? '1 point' : `${points} points`;
                        }
                    }
                },
                // Direct value labels in ink (not series color) — they double
                // as the low-contrast relief for lighter palette slots.
                datalabels: {
                    anchor: 'end',
                    align: 'right',
                    color: chrome.secondary,
                    font: { family: chrome.font, size: 11, weight: 600 },
                    formatter: value => value
                }
            }
        }
    });
}

/**
 * Single-series line of points per day for the month, up to the active day.
 */
function renderTrendChart(dailyPoints) {
    const canvas = document.getElementById('trend_chart');
    if (!canvas || typeof Chart === 'undefined' || typeof ChartDataLabels === 'undefined') return;

    const chrome = chartChrome();
    const labels = dailyPoints.map((_, index) => String(index + 1));
    const context = canvas.getContext('2d');
    const fill = context.createLinearGradient(0, 0, 0, canvas.parentElement?.clientHeight || 200);
    fill.addColorStop(0, hexToRgba(chrome.accent, 0.16));
    fill.addColorStop(1, hexToRgba(chrome.accent, 0));

    const description = document.getElementById('trend_chart_description');
    if (description) {
        const total = dailyPoints.reduce((sum, value) => sum + value, 0);
        description.textContent = `Daily points from the 1st through day ${dailyPoints.length}, totaling ${total} points.`;
    }

    charts.trend?.destroy();
    charts.trend = new Chart(context, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: dailyPoints,
                borderColor: chrome.accent,
                borderWidth: 2,
                backgroundColor: fill,
                fill: true,
                cubicInterpolationMode: 'monotone',
                pointRadius: dailyPoints.length === 1 ? 4 : 0,
                pointBackgroundColor: chrome.accent,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: chrome.accent,
                pointHoverBorderColor: chrome.surface,
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: prefersReducedMotion() ? 0 : 400 },
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    ticks: {
                        color: chrome.tick,
                        maxTicksLimit: 8,
                        maxRotation: 0,
                        font: { family: chrome.font, size: 11 }
                    },
                    border: { display: false },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0,
                        color: chrome.tick,
                        maxTicksLimit: 5,
                        font: { family: chrome.font, size: 11 }
                    },
                    border: { display: false },
                    grid: { color: chrome.grid, drawTicks: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...themedTooltip(chrome),
                    callbacks: {
                        title: items => `${formatKey(state.selectedDate, { month: 'long' })} ${items[0].label}`,
                        label: context => {
                            const points = context.parsed.y;
                            return points === 1 ? '1 point' : `${points} points`;
                        }
                    }
                }
            }
        }
    });
}

/** Re-render everything visual from cached data (used on theme change). */
function rerenderFromCache() {
    if (!state.currentUser) return;
    renderCategoryChips();
    renderHabitGrid();
    if (state.cache.dayRows && state.cache.dayKey === state.selectedDate) renderDay();
    if (state.cache.monthRows && state.cache.monthKey === state.selectedDate) renderMonth();
    if (state.cache.streakRows && state.cache.streakKey === state.selectedDate) renderStreaks();
}

// ---------------------------------------------------------------------------
// Event wiring & boot
// ---------------------------------------------------------------------------

function bindStaticEvents() {
    document.getElementById('prev_week_button').addEventListener('click', () => {
        selectDate(addDays(state.selectedDate, -7));
    });
    document.getElementById('next_week_button').addEventListener('click', () => {
        selectDate(addDays(state.selectedDate, 7));
    });
    document.getElementById('today_button').addEventListener('click', () => {
        selectDate(todayKey());
    });
    document.getElementById('date_picker').addEventListener('change', event => {
        selectDate(event.target.value);
    });

    document.getElementById('habit_search').addEventListener('input', event => {
        state.searchTerm = event.target.value;
        renderHabitGrid();
    });

    const quantityInput = document.getElementById('habit_quantity');
    quantityInput.addEventListener('input', () => setHabitQuantity(getHabitQuantity()));
    quantityInput.addEventListener('change', () => setHabitQuantity(getHabitQuantity()));
    document.getElementById('decrease_quantity_button').addEventListener('click', () => {
        setHabitQuantity(Math.max(1, getHabitQuantity() - 1));
    });
    document.getElementById('increase_quantity_button').addEventListener('click', () => {
        setHabitQuantity(getHabitQuantity() + 1);
    });
    document.getElementById('record_habit_button').addEventListener('click', onRecordHabitClicked);

    document.getElementById('auth_button').addEventListener('click', () => {
        if (state.currentUser) {
            signOut();
        } else {
            promptSignIn();
        }
    });
    document.getElementById('reconfigure_button').addEventListener('click', () => {
        window.reconfigureApp();
    });
}

(async function initializeApp() {
    initializeTheme();
    bindStaticEvents();
    renderWeekStrip();
    updateDayContext();

    // Start the module request while the shell/config work runs. Initialization
    // still awaits it below so CDN failures keep the existing friendly state.
    void preloadSupabaseModule().catch(() => {});

    if (!(await initializeConfig())) {
        renderFatalState('Configuration required', 'Refresh the page when you are ready to finish setting up your habit tracker.');
        return;
    }

    if (!(await initializeSupabase())) {
        renderFatalState('Connection issue', 'The Supabase client could not be started. Check your connection and saved setup, then refresh the page.');
        return;
    }

    await checkIfUserIsLoggedIn();
})();
