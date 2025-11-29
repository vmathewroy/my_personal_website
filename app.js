import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// Configuration storage key
const CONFIG_STORAGE_KEY = 'habitTrackerConfig';

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
 * Prompt user for configuration values
 */
function promptForConfig() {
    alert('Welcome! Please enter your Supabase configuration details.');
    
    let supabaseUrl = prompt('Enter your Supabase URL:');
    if (!supabaseUrl) {
        alert('Configuration cancelled. The app requires configuration to work.');
        return false;
    }
    
    let supabaseKey = prompt('Enter your Supabase API Key:');
    if (!supabaseKey) {
        alert('Configuration cancelled. The app requires configuration to work.');
        return false;
    }
    
    let redirectUrl = prompt('Enter your Redirect URL:');
    if (!redirectUrl) {
        alert('Configuration cancelled. The app requires configuration to work.');
        return false;
    }
    
    saveConfig(supabaseUrl, supabaseKey, redirectUrl);
    alert('Configuration saved successfully!');
    return true;
}

/**
 * Check and initialize configuration
 */
function initializeConfig() {
    const hasConfig = loadConfig();
    
    if (!hasConfig || !CONFIG.supabaseUrl || !CONFIG.supabaseKey || !CONFIG.redirectUrl) {
        return promptForConfig();
    }
    
    return true;
}

/**
 * Reconfigure the application (called from UI button)
 */
window.reconfigureApp = function() {
    const confirm = window.confirm('Are you sure you want to reconfigure? This will reload the page after saving new settings.');
    if (confirm) {
        if (promptForConfig()) {
            location.reload();
        }
    }
};

// Color palette for categories (will cycle through these)
const CATEGORY_COLORS = [
    { border: '#2196F3', bg: '#E3F2FD' },  // Blue
    { border: '#4CAF50', bg: '#E8F5E9' },  // Green
    { border: '#FF9800', bg: '#FFF3E0' },  // Orange
    { border: '#9C27B0', bg: '#F3E5F5' },  // Purple
    { border: '#F44336', bg: '#FFEBEE' },  // Red
    { border: '#00BCD4', bg: '#E0F7FA' },  // Cyan
    { border: '#FFEB3B', bg: '#FFFDE7' },  // Yellow
    { border: '#E91E63', bg: '#FCE4EC' },  // Pink
    { border: '#009688', bg: '#E0F2F1' },  // Teal
    { border: '#FF5722', bg: '#FBE9E7' },  // Deep Orange
    { border: '#673AB7', bg: '#EDE7F6' },  // Deep Purple
    { border: '#8BC34A', bg: '#F1F8E9' }   // Light Green
];

// Application state
const state = {
    categories: new Map(),
    categoryColors: new Map(), // Store color assignments
    habits: [], // Store all habits in memory
    currentUser: null,
    selectedDate: new Date().toLocaleDateString('en-CA') // Default to today
};

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
        console.log("Logged in as:", state.currentUser.email)
        await loadAllHabits() // Load all habits into memory
        await loadCategories() // Load categories for dropdowns
        initializeDatePicker() // Set up date picker
        await fetchAndDisplayLoggedPoints(state.selectedDate) // Display logged points for selected date
    } else {
        console.log("No user logged in")
        // Show a login prompt (simplified for this example)
        const email = prompt("Please enter your email to login:")
        if (email) {
            await loginWithEmail(email)
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
        alert(error.message)
    } else {
        alert("Check your email for the login link!")
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
    
    // Set default value to today
    datePicker.value = state.selectedDate;
    
    // Add event listener for date changes
    datePicker.addEventListener('change', async function(event) {
        state.selectedDate = event.target.value;
        await fetchAndDisplayLoggedPoints(state.selectedDate);
    });
}

/**
 * Fetch and display logged points for a specific date in a nested structure
 */
async function fetchAndDisplayLoggedPoints(date) {
    const listElement = document.getElementById('logged_points_list');
    const headingElement = document.getElementById('points_heading');
    listElement.innerHTML = ''; // Clear the "Loading" message

    // Update heading based on selected date
    const today = new Date().toLocaleDateString('en-CA');
    const selectedDateObj = new Date(date + 'T00:00:00');
    const dateString = selectedDateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    if (date === today) {
        headingElement.textContent = "Today's Logged Points";
    } else {
        headingElement.textContent = `Logged Points for ${dateString}`;
    }

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
        listElement.innerHTML = `<li>Error loading points: ${error.message}</li>`;
        return;
    }

    // Organize habits by category
    const habitsByCategory = {};
    
    if (data && data.length > 0) {
        console.log(data)
        
        // Group habits by category
        data.forEach(row => {
            const categoryId = row.habits.category;
            if (!habitsByCategory[categoryId]) {
                habitsByCategory[categoryId] = {
                    totalPoints: 0,
                    habits: []
                };
            }
            
            habitsByCategory[categoryId].totalPoints += row.habits.default_points;
            habitsByCategory[categoryId].habits.push({
                name: row.habits.name,
                points: row.habits.default_points
            });
        });
        
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
            categoryItem.textContent = `${categoryName}: ${totalPoints} total ${pointWord}`;
            
            // Apply color styling
            categoryItem.style.borderLeftColor = color.border;
            categoryItem.style.backgroundColor = color.bg;
            categoryItem.setAttribute('data-category-id', categoryId);
            
            // Create nested list for habits
            const habitsList = document.createElement('ul');
            categoryData.habits.forEach(habit => {
                const habitItem = document.createElement('li');
                const habitPointWord = habit.points === 1 ? 'point' : 'points';
                habitItem.textContent = `${habit.name}; ${habit.points} ${habitPointWord}`;
                // Subtle border color for habits matching category
                habitItem.style.borderLeftColor = color.border;
                habitsList.appendChild(habitItem);
            });
            
            categoryItem.appendChild(habitsList);
            listElement.appendChild(categoryItem);
        }
    } else {
        if (date === today) {
            listElement.innerHTML = '<li>No points earned today.</li>';
        } else {
            listElement.innerHTML = `<li>No points earned on ${dateString}.</li>`;
        }
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
        console.log('Loaded habits:', state.habits);
    }
}

/**
 * Handle category selection - populate habit dropdown with habits from selected category
 */
function onCategorySelected(categoryId) {
    console.log('Category selected:', categoryId);
    console.log('Category name:', state.categories[categoryId]);
    
    const habitDropdown = document.getElementById('habit_dropdown');
    const habitSelectionContainer = document.getElementById('habit_selection_container');
    const recordButtonContainer = document.getElementById('record_button_container');
    
    // Clear existing options except the first placeholder
    habitDropdown.innerHTML = '<option value="">-- Choose a habit --</option>';
    
    // Hide record button when category changes
    recordButtonContainer.style.display = 'none';
    
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
        habitSelectionContainer.style.display = 'block';
    } else {
        // Hide the habit selection if no habits found
        habitSelectionContainer.style.display = 'none';
        console.log('No habits found for category:', categoryId);
    }
}

/**
 * Handle habit selection - show the record button
 */
function onHabitSelected(habitId) {
    console.log('Habit selected:', habitId);
    
    const recordButtonContainer = document.getElementById('record_button_container');
    
    if (habitId) {
        // Show the record button
        recordButtonContainer.style.display = 'block';
    } else {
        // Hide if no habit is selected
        recordButtonContainer.style.display = 'none';
    }
}

/**
 * Record a habit by inserting it into the habit_log table
 */
async function onRecordHabitClicked() {
    const habitDropdown = document.getElementById('habit_dropdown');
    const recordButton = document.getElementById('record_habit_button');
    
    const selectedHabitId = habitDropdown.value;
    
    if (!selectedHabitId) {
        alert('Please select a habit first');
        return;
    }
    
    // Find the selected habit details
    const selectedHabit = state.habits.find(habit => habit.id == selectedHabitId);
    
    if (!selectedHabit) {
        alert('Habit not found');
        return;
    }
    
    console.log('Recording habit:', selectedHabit);
    
    // Disable button to prevent double clicks
    recordButton.disabled = true;
    recordButton.textContent = 'Recording...';
    
    try {
        // Get today's date in the correct format
        const localDate = new Date().toLocaleDateString('en-CA');
        
        // Insert the habit log entry
        const { data, error } = await supabase
            .from(CONFIG.tables.habitLog)
            .insert({
                date: localDate,
                habit: selectedHabitId,
                recorded_points: selectedHabit.default_points
            })
            .select();
        
        if (error) {
            console.error('Error recording habit:', error);
            alert(`Error recording habit: ${error.message}`);
            return;
        }
        
        console.log('Habit recorded successfully:', data);
        
        // Refresh the logged points display for the selected date
        await fetchAndDisplayLoggedPoints(state.selectedDate);
        
        // Reset the form
        document.getElementById('category_dropdown').value = '';
        habitDropdown.value = '';
        document.getElementById('habit_selection_container').style.display = 'none';
        document.getElementById('record_button_container').style.display = 'none';
        
        // Show success message
        alert(`Habit "${selectedHabit.name}" recorded successfully! (${selectedHabit.default_points} points)`);
        
    } catch (err) {
        console.error('Unexpected error:', err);
        alert('An unexpected error occurred');
    } finally {
        // Re-enable button
        recordButton.disabled = false;
        recordButton.textContent = 'Record Habit';
    }
}

/**
 * Initialize event listeners for the habit tracker
 */
function initializeEventListeners() {
    const categoryDropdown = document.getElementById('category_dropdown');
    const habitDropdown = document.getElementById('habit_dropdown');
    const recordButton = document.getElementById('record_habit_button');
    
    // Add event listener for category selection
    categoryDropdown.addEventListener('change', function(event) {
        const selectedCategoryId = event.target.value;
        
        if (selectedCategoryId) {
            onCategorySelected(selectedCategoryId);
        }
    });
    
    // Add event listener for habit selection
    habitDropdown.addEventListener('change', function(event) {
        const selectedHabitId = event.target.value;
        onHabitSelected(selectedHabitId);
    });
    
    // Add event listener for record button
    recordButton.addEventListener('click', function() {
        onRecordHabitClicked();
    });
}

// Initialize application on page load
(async function initializeApp() {
    // First, check and load configuration
    if (!initializeConfig()) {
        document.body.innerHTML = '<div style="padding: 20px; text-align: center;"><h1>Configuration Required</h1><p>Please refresh the page to configure the application.</p></div>';
        return;
    }
    
    // Initialize Supabase with the loaded config
    if (!initializeSupabase()) {
        document.body.innerHTML = '<div style="padding: 20px; text-align: center;"><h1>Configuration Error</h1><p>Invalid configuration. Please refresh and try again.</p></div>';
        return;
    }
    
    // Now check if user is logged in
    await checkIfUserIsLoggedIn();
})();