import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.7/+esm'

// Configuration storage key
const CONFIG_STORAGE_KEY = 'habitTrackerConfig';
const MAX_HABIT_QUANTITY = 99;

// Default configuration structure
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

/**
 * Load configuration from localStorage
 */
function loadConfig() {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            CONFIG.supabaseUrl = parsed.supabaseUrl || '';
            CONFIG.supabaseKey = parsed.supabaseKey || '';
            CONFIG.redirectUrl = parsed.redirectUrl || '';
            return true;
        } catch (e) {
            console.error('Error parsing stored config:', e);
            return false;
        }
    }
    return false;
}

/**
 * Save configuration to localStorage
 */
function saveConfig(supabaseUrl, supabaseKey, redirectUrl) {
    const configData = {
        supabaseUrl,
        supabaseKey,
        redirectUrl
    };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configData));
    CONFIG.supabaseUrl = supabaseUrl;
    CONFIG.supabaseKey = supabaseKey;
    CONFIG.redirectUrl = redirectUrl;
}

/**
 * Present setup and sign-in forms inside the app instead of browser prompts.
 */
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
        eyebrowElement.className = 'panel-kicker';
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

/**
 * Ask for Supabase configuration values.
 */
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

/**
 * Check and initialize configuration
 */
async function initializeConfig() {
    const hasConfig = loadConfig();
    
    if (!hasConfig || !CONFIG.supabaseUrl || !CONFIG.supabaseKey || !CONFIG.redirectUrl) {
        return await promptForConfig();
    }
    
    return true;
}

/**
 * Reconfigure the application (called from UI button)
 */
window.reconfigureApp = async function() {
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

// Color palette for categories (will cycle through these)
const CATEGORY_COLORS = [
    { border: '#78c9ff', bg: 'rgba(120, 201, 255, 0.24)' },
    { border: '#87e7c5', bg: 'rgba(135, 231, 197, 0.24)' },
    { border: '#ffb86b', bg: 'rgba(255, 184, 107, 0.24)' },
    { border: '#aa98ff', bg: 'rgba(170, 152, 255, 0.24)' },
    { border: '#ff8f91', bg: 'rgba(255, 143, 145, 0.24)' },
    { border: '#65dce6', bg: 'rgba(101, 220, 230, 0.24)' },
    { border: '#f2d66f', bg: 'rgba(242, 214, 111, 0.24)' },
    { border: '#f39ac7', bg: 'rgba(243, 154, 199, 0.24)' },
    { border: '#6fd8bc', bg: 'rgba(111, 216, 188, 0.24)' },
    { border: '#ff9cac', bg: 'rgba(255, 156, 172, 0.24)' },
    { border: '#c0a6ff', bg: 'rgba(192, 166, 255, 0.24)' },
    { border: '#b8f36a', bg: 'rgba(184, 243, 106, 0.24)' }
];

// Application state
const state = {
    categories: {},
    categoryColors: new Map(), // Store color assignments
    habits: [], // Store all habits in memory
    currentUser: null,
    selectedDate: new Date().toLocaleDateString('en-CA') // Default to today
};

// Chart instances
let pointsChart = null;
let progressChart = null;
let toastTimer = null;

/**
 * Read a theme value so Chart.js stays visually aligned with the page.
 */
function getThemeValue(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

/**
 * Give category charts enough room to render every category as its own row.
 */
function sizeCategoryChart(canvas, categoryCount, isCompact, minimumHeight) {
    const chartCanvas = canvas.closest('.chart-canvas');
    if (!chartCanvas) return;

    const rowHeight = isCompact ? 38 : 36;
    const chartHeight = Math.max(minimumHeight, (categoryCount * rowHeight) + 52);
    chartCanvas.style.height = `${chartHeight}px`;
}

/**
 * Replace loading, empty, or error content with an accessible status message.
 */
function setContainerMessage(container, message, type = 'empty') {
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

/**
 * Show non-blocking feedback after a habit is recorded.
 */
function showToast(message, type = 'success') {
    const toast = document.getElementById('app_toast');
    if (!toast) return;

    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('is-error', type === 'error');
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => {
        toast.classList.remove('is-visible');
    }, 3600);
}

/**
 * Keep the active-day context and selected-month labels in sync.
 */
function updateDateContext(date) {
    const dateObject = new Date(`${date}T00:00:00`);
    const today = new Date().toLocaleDateString('en-CA');
    const shortDate = dateObject.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric'
    });
    const longDate = dateObject.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });
    const monthLabel = dateObject.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
    });

    const activeDateLabel = document.getElementById('active_date_label');
    const logDateLabel = document.getElementById('log_date_label');
    const progressPeriod = document.getElementById('progress_period');
    const topHabitsPeriod = document.getElementById('top_habits_period');

    if (activeDateLabel) {
        activeDateLabel.textContent = date === today ? `Today · ${shortDate}` : longDate;
    }
    if (logDateLabel) {
        logDateLabel.textContent = date === today ? 'today' : shortDate;
    }
    if (progressPeriod) {
        progressPeriod.textContent = monthLabel;
    }
    if (topHabitsPeriod) {
        topHabitsPeriod.textContent = monthLabel;
    }
}

/**
 * Render configuration failures using the same visual language as the app.
 */
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

/**
 * Get color for a category ID (assigns consistently based on category ID)
 * Uses a simple hash to ensure the same category always gets the same color
 */
function getCategoryColor(categoryId) {
    if (!state.categoryColors.has(categoryId)) {
        // Create a simple hash from the category ID
        let hash = 0;
        const idString = String(categoryId);
        for (let i = 0; i < idString.length; i++) {
            hash = ((hash << 5) - hash) + idString.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit integer
        }
        // Use absolute value and modulo to get a consistent color index
        const colorIndex = Math.abs(hash) % CATEGORY_COLORS.length;
        state.categoryColors.set(categoryId, CATEGORY_COLORS[colorIndex]);
    }
    return state.categoryColors.get(categoryId);
}

/**
 * Render or update the bar chart showing points per category
 * @param {Object} categoryPoints - Object mapping category IDs to total points
 */
function renderPointsChart(categoryPoints) {
    const canvas = document.getElementById('points_chart');

    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }

    // Get all categories and their points (including zero points)
    const categoryIds = Object.keys(state.categories);
    const labels = [];
    const data = [];
    const backgroundColors = [];
    const borderColors = [];

    categoryIds.forEach(categoryId => {
        const categoryName = state.categories[categoryId];
        const points = categoryPoints[categoryId] || 0; // Default to 0 if no points
        const color = getCategoryColor(categoryId);

        labels.push(categoryName);
        data.push(points);
        backgroundColors.push(color.bg);
        borderColors.push(color.border);
    });

    const chartDescription = document.getElementById('points_chart_description');
    if (chartDescription) {
        chartDescription.textContent = labels.length
            ? labels.map((label, index) => `${label}: ${data[index]} ${data[index] === 1 ? 'point' : 'points'}`).join('. ')
            : 'No habit categories are available yet.';
    }

    // Destroy existing chart if it exists
    if (pointsChart) {
        pointsChart.destroy();
    }

    const textColor = getThemeValue('--text-secondary', '#9ea8b5');
    const subtleColor = getThemeValue('--text-subtle', '#6f7a89');
    const surfaceColor = getThemeValue('--surface-raised', '#171f2a');
    const borderColor = getThemeValue('--border-strong', 'rgba(255, 255, 255, 0.14)');
    const fontFamily = getThemeValue('--font-body', 'sans-serif');
    const isCompact = window.matchMedia('(max-width: 640px)').matches;
    sizeCategoryChart(canvas, labels.length, isCompact, isCompact ? 250 : 275);

    // Create new chart
    const ctx = canvas.getContext('2d');
    pointsChart = new Chart(ctx, {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: labels,
            datasets: [{
                label: 'Points',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 9,
                borderSkipped: false,
                maxBarThickness: isCompact ? 26 : 30
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550
            },
            layout: {
                padding: {
                    right: isCompact ? 18 : 28
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grace: '10%',
                    ticks: {
                        stepSize: 1,
                        color: subtleColor,
                        padding: 8,
                        font: {
                            family: fontFamily,
                            size: 11,
                            weight: 600
                        }
                    },
                    border: {
                        display: false
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.06)',
                        drawTicks: false
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        autoSkip: false,
                        padding: 9,
                        font: {
                            family: fontFamily,
                            size: isCompact ? 10 : 11,
                            weight: 600
                        },
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            const maxLength = isCompact ? 12 : 18;
                            return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
                        }
                    },
                    border: {
                        display: false
                    },
                    grid: {
                        display: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: surfaceColor,
                    borderColor: borderColor,
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    titleColor: getThemeValue('--text-primary', '#f4f7f2'),
                    bodyColor: textColor,
                    titleFont: {
                        family: fontFamily,
                        size: 13
                    },
                    bodyFont: {
                        family: fontFamily,
                        size: 12
                    },
                    callbacks: {
                        label: function(context) {
                            const points = context.parsed.x;
                            return points === 1 ? '1 point' : `${points} points`;
                        }
                    }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'right',
                    formatter: function(value) {
                        return value;
                    },
                    font: {
                        family: fontFamily,
                        weight: 700,
                        size: 11
                    },
                    color: function(context) {
                        return context.dataset.data[context.dataIndex] === 0
                            ? subtleColor
                            : borderColors[context.dataIndex];
                    }
                }
            }
        }
    });
}

// Initialize the Supabase Client (will be set after config is loaded)
let supabase;

/**
 * Initialize Supabase client with current config
 */
function initializeSupabase() {
    if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
        console.error('Cannot initialize Supabase without URL and Key');
        return false;
    }
    supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
    return true;
}

// Check if user is already logged in
async function checkIfUserIsLoggedIn() {
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
        state.currentUser = user;
        await loadAllHabits() // Load all habits into memory
        await loadCategories() // Load categories for dropdowns
        initializeDatePicker() // Set up date picker
        await fetchAndDisplayLoggedPoints(state.selectedDate) // Display logged points for selected date
        await fetchAndDisplayProgress(state.selectedDate) // Display monthly progress
        await fetchAndDisplayTopHabits(state.selectedDate) // Display top habits for the month
    } else {
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
            await loginWithEmail(values.email)
        } else {
            setContainerMessage(document.getElementById('logged_points_list'), 'Sign in when you are ready to load your daily activity.');
            setContainerMessage(document.getElementById('progress_summary'), 'Sign in to see your monthly progress.');
            setContainerMessage(document.getElementById('top_habits_list'), 'Sign in to see your most consistent habits.');
        }
    }
}

async function loginWithEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
            emailRedirectTo: CONFIG.redirectUrl
        }
    })

    if (error) {
        showToast(`We couldn't send the login link. ${error.message}`, 'error')
    } else {
        showToast('Magic link sent. Check your email to finish signing in.')
        setContainerMessage(document.getElementById('logged_points_list'), 'Check your email for the magic link, then return here to continue.');
        setContainerMessage(document.getElementById('progress_summary'), 'Your progress will appear after you sign in.');
        setContainerMessage(document.getElementById('top_habits_list'), 'Your top habits will appear after you sign in.');
    }
}

/**
 * Load categories from Supabase
 */
async function loadCategories() {
    // Get the category dropdown element
    const categoryDropdown = document.getElementById('category_dropdown');

    // Select categories from table
    const { data, error } = await supabase
        .from(CONFIG.tables.habitCategories)
        .select('id, category_name');

    if (error) {
        console.error('Error fetching categories:', error);
        return;
    }

    // Process and store categories
    if (data) {
        data.forEach(row => {
            state.categories[row.id] = row.category_name;
            
            // Add category to dropdown
            const option = document.createElement('option');
            option.value = row.id;
            option.textContent = row.category_name;
            categoryDropdown.appendChild(option);
        });
        
        // Set up event listeners after categories are loaded
        initializeEventListeners();
    }
}

/**
 * Initialize date picker with today's date and add event listener
 */
function initializeDatePicker() {
    const datePicker = document.getElementById('date_picker');
    const prevButton = document.getElementById('prev_date_button');
    const nextButton = document.getElementById('next_date_button');
    const todayButton = document.getElementById('today_button');

    // Set default value to today
    datePicker.value = state.selectedDate;
    updateDateContext(state.selectedDate);

    async function selectDate(date) {
        if (!date) return;

        state.selectedDate = date;
        datePicker.value = date;
        updateDateContext(date);

        document.getElementById('logged_points_list').setAttribute('aria-busy', 'true');
        document.getElementById('progress_summary').setAttribute('aria-busy', 'true');
        document.getElementById('top_habits_list').setAttribute('aria-busy', 'true');

        await Promise.all([
            fetchAndDisplayLoggedPoints(date),
            fetchAndDisplayProgress(date),
            fetchAndDisplayTopHabits(date)
        ]);
    }

    // Add event listener for date changes
    datePicker.addEventListener('change', async function(event) {
        await selectDate(event.target.value);
    });

    // Add event listener for previous date button
    prevButton.addEventListener('click', async function() {
        const currentDate = new Date(state.selectedDate + 'T00:00:00');
        currentDate.setDate(currentDate.getDate() - 1);
        await selectDate(currentDate.toLocaleDateString('en-CA'));
    });

    // Add event listener for next date button
    nextButton.addEventListener('click', async function() {
        const currentDate = new Date(state.selectedDate + 'T00:00:00');
        currentDate.setDate(currentDate.getDate() + 1);
        await selectDate(currentDate.toLocaleDateString('en-CA'));
    });

    // Add event listener for today button
    todayButton.addEventListener('click', async function() {
        const today = new Date().toLocaleDateString('en-CA');
        await selectDate(today);
    });
}

/**
 * Fetch and display logged points for a specific date in a nested structure
 */
async function fetchAndDisplayLoggedPoints(date) {
    const listElement = document.getElementById('logged_points_list');
    const headingElement = document.getElementById('points_heading');
    const totalBadge = document.getElementById('total_points_badge');
    listElement.replaceChildren(); // Clear the loading message
    listElement.removeAttribute('role');

    // Update heading based on selected date
    const today = new Date().toLocaleDateString('en-CA');
    const selectedDateObj = new Date(date + 'T00:00:00');
    const dateString = selectedDateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const weekday = selectedDateObj.toLocaleDateString('en-US', { weekday: 'long' });
    headingElement.textContent = date === today ? "Today's activity" : `${weekday}'s activity`;

    // Fetch habit log entries for the selected date
    const { data, error } = await supabase
        .from(CONFIG.tables.habitLog)
        .select(`
                date,
                habits (
                name,
                default_points,
                category
                )
            `)
        .eq('date', date)

    if (error) {
        console.error('Error fetching data:', error);
        setContainerMessage(listElement, `We couldn't load this day's activity. ${error.message}`, 'error');
        return;
    }

    // Organize habits by category
    const habitsByCategory = {};
    let totalPoints = 0;

    if (data && data.length > 0) {
        // Group habits by category and aggregate duplicates
        data.forEach(row => {
            const categoryId = row.habits.category;
            const habitName = row.habits.name;
            const points = row.habits.default_points;
            
            if (!habitsByCategory[categoryId]) {
                habitsByCategory[categoryId] = {
                    totalPoints: 0,
                    habits: {}
                };
            }

            // Aggregate habits by name within category
            if (!habitsByCategory[categoryId].habits[habitName]) {
                habitsByCategory[categoryId].habits[habitName] = {
                    count: 0,
                    totalPoints: 0,
                    pointsPerEntry: points
                };
            }
            
            habitsByCategory[categoryId].habits[habitName].count += 1;
            habitsByCategory[categoryId].habits[habitName].totalPoints += points;
            habitsByCategory[categoryId].totalPoints += points;
            totalPoints += points;
        });

        // Update total points badge
        const pointWord = totalPoints === 1 ? 'point' : 'points';
        totalBadge.textContent = `${totalPoints} ${pointWord}`;

        // Build the nested list structure
        for (const categoryId in habitsByCategory) {
            const categoryData = habitsByCategory[categoryId];
            const categoryName = state.categories[categoryId];
            const totalPoints = categoryData.totalPoints;
            
            // Get color for this category (based on category ID)
            const color = getCategoryColor(categoryId);
            
            // Create the category list item
            const categoryItem = document.createElement('li');
            const pointWord = totalPoints === 1 ? 'point' : 'points';
            const categorySummary = document.createElement('div');
            const categoryNameElement = document.createElement('span');
            const categoryPointsElement = document.createElement('span');

            categorySummary.className = 'category-summary';
            categoryNameElement.className = 'category-name';
            categoryPointsElement.className = 'category-points';
            categoryNameElement.textContent = categoryName;
            categoryPointsElement.textContent = `${totalPoints} ${pointWord}`;
            categorySummary.append(categoryNameElement, categoryPointsElement);

            // Apply the category color through one reusable theme hook.
            categoryItem.style.setProperty('--category-color', color.border);
            categoryItem.setAttribute('data-category-id', categoryId);
            categoryItem.appendChild(categorySummary);
            
            // Create nested list for habits (now aggregated)
            const habitsList = document.createElement('ul');
            const habitEntries = Object.entries(categoryData.habits);
            
            // Sort habits by count (descending) for better visibility
            habitEntries.sort((a, b) => b[1].count - a[1].count);
            
            habitEntries.forEach(([habitName, habitData]) => {
                const habitItem = document.createElement('li');
                const habitPointWord = habitData.totalPoints === 1 ? 'point' : 'points';
                const countDisplay = habitData.count > 1 ? ` (${habitData.count}x)` : '';
                const habitNameElement = document.createElement('span');
                const habitPointsElement = document.createElement('span');

                habitNameElement.className = 'habit-name-label';
                habitPointsElement.className = 'habit-points-label';
                habitNameElement.textContent = `${habitName}${countDisplay}`;
                habitPointsElement.textContent = `${habitData.totalPoints} ${habitPointWord}`;
                habitItem.append(habitNameElement, habitPointsElement);
                habitsList.appendChild(habitItem);
            });
            
            categoryItem.appendChild(habitsList);
            listElement.appendChild(categoryItem);
        }
        
        // Render the chart with category points
        const categoryPoints = {};
        for (const categoryId in habitsByCategory) {
            categoryPoints[categoryId] = habitsByCategory[categoryId].totalPoints;
        }
        listElement.setAttribute('aria-busy', 'false');
        renderPointsChart(categoryPoints);
    } else {
        // No points logged - update badge to show 0
        totalBadge.textContent = '0 points';

        const emptyMessage = date === today
            ? 'Nothing logged yet today. Your next small win starts here.'
            : `Nothing was logged on ${dateString}.`;
        setContainerMessage(listElement, emptyMessage);

        // Render chart with all categories at 0 points
        renderPointsChart({});
    }
}

/**
 * Fetch and display progress for the current month up to the previous day
 */
async function fetchAndDisplayProgress(currentDate) {
    const progressSummary = document.getElementById('progress_summary');
    
    // Parse the current date
    const currentDateObj = new Date(currentDate + 'T00:00:00');
    
    // Calculate the previous day (end date for progress)
    const endDateObj = new Date(currentDateObj);
    endDateObj.setDate(endDateObj.getDate() - 1);
    const endDate = endDateObj.toLocaleDateString('en-CA');
    
    // Calculate the start date (first day of the current month)
    const startDateObj = new Date(currentDateObj.getFullYear(), currentDateObj.getMonth(), 1);
    const startDate = startDateObj.toLocaleDateString('en-CA');
    
    // Format month and year for display
    const monthYearDisplay = currentDateObj.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric'
    });
    
    // Fetch habit log entries for the date range
    const { data, error } = await supabase
        .from(CONFIG.tables.habitLog)
        .select(`
            date,
            habits (
                default_points,
                category
            )
        `)
        .gte('date', startDate)
        .lte('date', endDate);
    
    if (error) {
        console.error('Error fetching progress data:', error);
        setContainerMessage(progressSummary, `We couldn't load monthly progress. ${error.message}`, 'error');
        return;
    }
    
    // Calculate total points and points per category
    let totalPoints = 0;
    const categoryPoints = {};
    
    if (data && data.length > 0) {
        data.forEach(row => {
            const points = row.habits.default_points;
            const categoryId = row.habits.category;
            
            totalPoints += points;
            
            if (!categoryPoints[categoryId]) {
                categoryPoints[categoryId] = 0;
            }
            categoryPoints[categoryId] += points;
        });
    }
    
    // Build the monthly metric without interpolating data into HTML.
    const pointWord = totalPoints === 1 ? 'point' : 'points';
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
    metricValue.textContent = totalPoints;
    metricUnit.textContent = pointWord;
    dateRange.textContent = currentDateObj.getDate() === 1
        ? `${monthYearDisplay} has just begun.`
        : `${monthYearDisplay}, through the previous day.`;

    valueRow.append(metricValue, metricUnit);
    metricCopy.append(metricLabel, valueRow);
    progressSummary.replaceChildren(metricCopy, dateRange);
    progressSummary.removeAttribute('role');
    progressSummary.setAttribute('aria-busy', 'false');
    
    // Render the horizontal bar chart
    renderProgressChart(categoryPoints);
}

/**
 * Render or update the horizontal bar chart showing progress by category
 * @param {Object} categoryPoints - Object mapping category IDs to total points
 */
function renderProgressChart(categoryPoints) {
    const canvas = document.getElementById('progress_chart');

    if (!canvas) {
        console.error('Progress chart canvas element not found');
        return;
    }

    // Start with every category, then place categories with earned points first.
    const sortedCategories = Object.keys(state.categories)
        .map(categoryId => [categoryId, categoryPoints[categoryId] || 0])
        .sort((a, b) => b[1] - a[1]);

    const labels = [];
    const data = [];
    const backgroundColors = [];
    const borderColors = [];

    sortedCategories.forEach(([categoryId, points]) => {
        const categoryName = state.categories[categoryId];
        const color = getCategoryColor(categoryId);

        labels.push(categoryName);
        data.push(points);
        backgroundColors.push(color.bg);
        borderColors.push(color.border);
    });

    const chartDescription = document.getElementById('progress_chart_description');
    if (chartDescription) {
        chartDescription.textContent = labels.length
            ? labels.map((label, index) => `${label}: ${data[index]} ${data[index] === 1 ? 'point' : 'points'}`).join('. ')
            : 'No category points have been earned in this period yet.';
    }

    // Destroy existing chart if it exists
    if (progressChart) {
        progressChart.destroy();
    }

    const textColor = getThemeValue('--text-secondary', '#9ea8b5');
    const subtleColor = getThemeValue('--text-subtle', '#6f7a89');
    const surfaceColor = getThemeValue('--surface-raised', '#171f2a');
    const chartBorderColor = getThemeValue('--border-strong', 'rgba(255, 255, 255, 0.14)');
    const fontFamily = getThemeValue('--font-body', 'sans-serif');
    const isCompact = window.matchMedia('(max-width: 640px)').matches;
    sizeCategoryChart(canvas, labels.length, isCompact, isCompact ? 265 : 285);

    // Create new horizontal bar chart
    const ctx = canvas.getContext('2d');
    progressChart = new Chart(ctx, {
        type: 'bar',
        plugins: [ChartDataLabels],
        data: {
            labels: labels,
            datasets: [{
                label: 'Points',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: 9,
                borderSkipped: false,
                maxBarThickness: isCompact ? 26 : 30
            }]
        },
        options: {
            indexAxis: 'y', // This makes it horizontal
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 550
            },
            layout: {
                padding: {
                    right: isCompact ? 18 : 28
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grace: '10%',
                    ticks: {
                        stepSize: 1,
                        color: subtleColor,
                        padding: 8,
                        font: {
                            family: fontFamily,
                            size: 11,
                            weight: 600
                        }
                    },
                    border: {
                        display: false
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.06)',
                        drawTicks: false
                    }
                },
                y: {
                    ticks: {
                        color: textColor,
                        autoSkip: false,
                        padding: 9,
                        font: {
                            family: fontFamily,
                            size: isCompact ? 10 : 11,
                            weight: 600
                        },
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            const maxLength = isCompact ? 12 : 18;
                            return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
                        }
                    },
                    border: {
                        display: false
                    },
                    grid: {
                        display: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: surfaceColor,
                    borderColor: chartBorderColor,
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    titleColor: getThemeValue('--text-primary', '#f4f7f2'),
                    bodyColor: textColor,
                    titleFont: {
                        family: fontFamily,
                        size: 13
                    },
                    bodyFont: {
                        family: fontFamily,
                        size: 12
                    },
                    callbacks: {
                        label: function(context) {
                            const points = context.parsed.x;
                            return points === 1 ? '1 point' : `${points} points`;
                        }
                    }
                },
                datalabels: {
                    anchor: 'end',
                    align: 'right',
                    formatter: function(value) {
                        return value;
                    },
                    font: {
                        family: fontFamily,
                        weight: 700,
                        size: 11
                    },
                    color: function(context) {
                        return context.dataset.data[context.dataIndex] === 0
                            ? subtleColor
                            : borderColors[context.dataIndex];
                    }
                }
            }
        }
    });
}

/**
 * Fetch and display top 5 habits for the current month up to the previous day
 */
async function fetchAndDisplayTopHabits(currentDate) {
    const topHabitsList = document.getElementById('top_habits_list');

    // Parse the current date
    const currentDateObj = new Date(currentDate + 'T00:00:00');

    // Calculate the previous day (end date for top habits)
    const endDateObj = new Date(currentDateObj);
    endDateObj.setDate(endDateObj.getDate() - 1);
    const endDate = endDateObj.toLocaleDateString('en-CA');

    // Calculate the start date (first day of the current month)
    const startDateObj = new Date(currentDateObj.getFullYear(), currentDateObj.getMonth(), 1);
    const startDate = startDateObj.toLocaleDateString('en-CA');

    // Fetch habit log entries for the date range
    const { data, error } = await supabase
        .from(CONFIG.tables.habitLog)
        .select(`
            date,
            habit,
            habits (
                id,
                name,
                category
            )
        `)
        .gte('date', startDate)
        .lte('date', endDate);

    if (error) {
        console.error('Error fetching top habits data:', error);
        setContainerMessage(topHabitsList, `We couldn't load your top habits. ${error.message}`, 'error');
        return;
    }

    // Count occurrences of each habit
    const habitCounts = {};

    if (data && data.length > 0) {
        data.forEach(row => {
            const habitId = row.habit;
            const habitName = row.habits.name;
            const categoryId = row.habits.category;

            if (!habitCounts[habitId]) {
                habitCounts[habitId] = {
                    name: habitName,
                    category: categoryId,
                    count: 0
                };
            }
            habitCounts[habitId].count += 1;
        });
    }

    // Sort habits by count (descending) and take top 5
    const sortedHabits = Object.entries(habitCounts)
        .map(([habitId, data]) => ({ id: habitId, name: data.name, category: data.category, count: data.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    // Build the ranked list with text nodes so habit names remain safe.
    if (sortedHabits.length > 0) {
        const rankedList = document.createElement('ol');

        sortedHabits.forEach(habit => {
            const countWord = habit.count === 1 ? 'time' : 'times';
            const color = getCategoryColor(habit.category);
            const habitItem = document.createElement('li');
            const habitName = document.createElement('span');
            const habitCount = document.createElement('span');

            habitItem.style.setProperty('--category-color', color.border);
            habitName.className = 'habit-name';
            habitCount.className = 'habit-count';
            habitName.textContent = habit.name;
            habitCount.textContent = `${habit.count} ${countWord}`;
            habitItem.append(habitName, habitCount);
            rankedList.appendChild(habitItem);
        });

        topHabitsList.replaceChildren(rankedList);
        topHabitsList.removeAttribute('role');
        topHabitsList.setAttribute('aria-busy', 'false');
    } else {
        setContainerMessage(topHabitsList, 'No monthly streak leaders yet. Every check-in can take the first spot.');
    }
}

/**
 * Load all habits from Supabase and store in memory
 */
async function loadAllHabits() {
    const { data, error } = await supabase
        .from(CONFIG.tables.habits)
        .select('id, name, category, default_points');

    if (error) {
        console.error('Error fetching habits:', error);
        return;
    }

    if (data) {
        state.habits = data;
    }
}

/**
 * Return a valid whole-number quantity, defaulting invalid entries to one.
 */
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

/**
 * Update the quantity field and keep the primary action clear.
 */
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
    const label = recordButton.querySelector('span:first-child');

    label.textContent = quantity === 1 ? 'Log this habit' : `Log ${quantity} times`;
}

/**
 * Handle category selection - populate habit dropdown with habits from selected category
 */
function onCategorySelected(categoryId) {
    const habitDropdown = document.getElementById('habit_dropdown');
    const habitSelectionContainer = document.getElementById('habit_selection_container');
    const quantitySelectionContainer = document.getElementById('quantity_selection_container');
    const recordButtonContainer = document.getElementById('record_button_container');
    
    // Reset the later steps whenever the category changes.
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a habit';
    habitDropdown.replaceChildren(placeholder);
    habitSelectionContainer.hidden = true;
    quantitySelectionContainer.hidden = true;
    recordButtonContainer.hidden = true;
    setHabitQuantity(1);

    if (!categoryId) return;
    
    // Filter habits by selected category
    const categoryHabits = state.habits.filter(habit => habit.category == categoryId);
    
    if (categoryHabits.length > 0) {
        // Populate habit dropdown with filtered habits
        categoryHabits.forEach(habit => {
            const option = document.createElement('option');
            option.value = habit.id;
            option.textContent = habit.name;
            habitDropdown.appendChild(option);
        });
        
        // Show the habit selection dropdown
        habitSelectionContainer.hidden = false;
    } else {
        // Hide the habit selection if no habits found
        habitSelectionContainer.hidden = true;
    }
}

/**
 * Handle habit selection - show the record button
 */
function onHabitSelected(habitId) {
    const quantitySelectionContainer = document.getElementById('quantity_selection_container');
    const recordButtonContainer = document.getElementById('record_button_container');
    
    quantitySelectionContainer.hidden = !habitId;
    recordButtonContainer.hidden = !habitId;
    setHabitQuantity(1);
}

/**
 * Record a habit by inserting it into the habit_log table
 */
async function onRecordHabitClicked() {
    const habitDropdown = document.getElementById('habit_dropdown');
    const quantityInput = document.getElementById('habit_quantity');
    const decreaseQuantityButton = document.getElementById('decrease_quantity_button');
    const increaseQuantityButton = document.getElementById('increase_quantity_button');
    const recordButton = document.getElementById('record_habit_button');
    
    const selectedHabitId = habitDropdown.value;
    
    if (!selectedHabitId) {
        showToast('Choose a habit before logging it.', 'error');
        return;
    }
    
    // Find the selected habit details
    const selectedHabit = state.habits.find(habit => habit.id == selectedHabitId);
    
    if (!selectedHabit) {
        showToast('That habit could not be found. Try selecting it again.', 'error');
        return;
    }

    const quantity = getHabitQuantity();
    
    // Disable button to prevent double clicks
    recordButton.disabled = true;
    recordButton.setAttribute('aria-busy', 'true');
    recordButton.querySelector('span:first-child').textContent = quantity === 1 ? 'Logging…' : `Logging ${quantity}…`;
    quantityInput.disabled = true;
    decreaseQuantityButton.disabled = true;
    increaseQuantityButton.disabled = true;
    
    try {
        // Use the selected date instead of always using today
        const localDate = state.selectedDate;
        
        // Insert every completion in one request so the existing analytics remain accurate.
        const logEntries = Array.from({ length: quantity }, () => ({
            date: localDate,
            habit: selectedHabitId
        }));
        const { data, error } = await supabase
            .from(CONFIG.tables.habitLog)
            .insert(logEntries)
            .select();
        
        if (error) {
            console.error('Error recording habit:', error);
            showToast(`We couldn't log that habit. ${error.message}`, 'error');
            return;
        }
        
        // Refresh the logged points display for the selected date
        await Promise.all([
            fetchAndDisplayLoggedPoints(state.selectedDate),
            fetchAndDisplayProgress(state.selectedDate),
            fetchAndDisplayTopHabits(state.selectedDate)
        ]);

        // Reset the form
        document.getElementById('category_dropdown').value = '';
        habitDropdown.value = '';
        document.getElementById('habit_selection_container').hidden = true;
        document.getElementById('quantity_selection_container').hidden = true;
        document.getElementById('record_button_container').hidden = true;
        setHabitQuantity(1);
        
        // Show success message
        const totalPoints = Number(selectedHabit.default_points) * quantity;
        const pointWord = totalPoints === 1 ? 'point' : 'points';
        const quantityLabel = quantity === 1 ? selectedHabit.name : `${selectedHabit.name} ×${quantity}`;
        showToast(`${quantityLabel} logged · +${totalPoints} ${pointWord}`);
        
    } catch (err) {
        console.error('Unexpected error:', err);
        showToast('Something unexpected happened. Please try again.', 'error');
    } finally {
        // Re-enable button
        recordButton.disabled = false;
        recordButton.removeAttribute('aria-busy');
        quantityInput.disabled = false;
        decreaseQuantityButton.disabled = false;
        increaseQuantityButton.disabled = false;
        updateRecordButtonLabel();
    }
}

/**
 * Initialize event listeners for the habit tracker
 */
function initializeEventListeners() {
    const categoryDropdown = document.getElementById('category_dropdown');
    const habitDropdown = document.getElementById('habit_dropdown');
    const quantityInput = document.getElementById('habit_quantity');
    const decreaseQuantityButton = document.getElementById('decrease_quantity_button');
    const increaseQuantityButton = document.getElementById('increase_quantity_button');
    const recordButton = document.getElementById('record_habit_button');
    
    // Add event listener for category selection
    categoryDropdown.addEventListener('change', function(event) {
        const selectedCategoryId = event.target.value;
        onCategorySelected(selectedCategoryId);
    });
    
    // Add event listener for habit selection
    habitDropdown.addEventListener('change', function(event) {
        const selectedHabitId = event.target.value;
        onHabitSelected(selectedHabitId);
    });

    // Keep amount changes fast to use with repeated daily check-ins.
    quantityInput.addEventListener('input', function() {
        setHabitQuantity(getHabitQuantity());
    });

    quantityInput.addEventListener('change', function() {
        setHabitQuantity(getHabitQuantity());
    });

    decreaseQuantityButton.addEventListener('click', function() {
        setHabitQuantity(Math.max(1, getHabitQuantity() - 1));
    });

    increaseQuantityButton.addEventListener('click', function() {
        setHabitQuantity(getHabitQuantity() + 1);
    });
    
    // Add event listener for record button
    recordButton.addEventListener('click', function() {
        onRecordHabitClicked();
    });
}

// Initialize application on page load
(async function initializeApp() {
    // First, check and load configuration
    if (!(await initializeConfig())) {
        renderFatalState('Configuration required', 'Refresh the page when you are ready to finish setting up your habit tracker.');
        return;
    }
    
    // Initialize Supabase with the loaded config
    if (!initializeSupabase()) {
        renderFatalState('Configuration error', 'The saved setup is invalid. Refresh the page and try again.');
        return;
    }
    
    // Now check if user is logged in
    await checkIfUserIsLoggedIn();
})();
