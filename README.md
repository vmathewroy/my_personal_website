# Daily Habit Tracker

A web application for tracking daily habits and monitoring progress over time. Built with vanilla JavaScript and Supabase for database management and authentication.

## Features

- **Habit Logging**: Record daily habit completions organized by custom categories
- **Point System**: Each habit has a configurable point value to track your progress
- **Date Navigation**: View and log habits for any date, with easy navigation between days
- **Visual Analytics**:
  - Daily bar chart showing points earned per category
  - Monthly progress chart displaying cumulative performance
- **Secure Authentication**: Email-based magic link login powered by Supabase
- **Responsive Design**: Clean, dark-themed interface optimized for desktop use

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Database: Supabase (PostgreSQL)
- Charts: Chart.js with ChartDataLabels plugin
- Authentication: Supabase Auth (email OTP)
