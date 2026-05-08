/**
 * API Module - Handles all communication with the backend
 * Exports global state and API functions accessible to other modules
 */

// Global State Object - Shared across all modules
window.AppState = {
    API_URL: '/api',
    isRecording: false,
    currentSessionId: null,

    // DOM Elements - will be initialized when page loads
    elements: {
        dashboardView: null,
        detailsView: null,
        sessionList: null,
        startBtn: null,
        stopBtn: null,
        nameInput: null,
        globalStatus: null
    },

    // Chart data for current session
    chartData: {
        labels: [],
        engagement: [],
        confusion: [],
        frustration: [],
        flow: []
    }
};

/**
 * Initialize DOM element references for current page
 */
function initializeDOM() {
    AppState.elements.dashboardView = document.getElementById('dashboardView');
    AppState.elements.detailsView = document.getElementById('detailsView');
    AppState.elements.sessionList = document.getElementById('sessionList');
    AppState.elements.startBtn = document.getElementById('startBtn');
    AppState.elements.stopBtn = document.getElementById('stopBtn');
    AppState.elements.nameInput = document.getElementById('sessionNameInput');
    AppState.elements.globalStatus = document.getElementById('globalStatus');
}

/**
 * Fetch sessions from the backend
 */
async function fetchSessions() {
    try {
        const res = await fetch(`${AppState.API_URL}/sessions`);
        const data = await res.json();
        return data.sessions || [];
    } catch (error) {
        console.error('Failed to fetch sessions:', error);
        return [];
    }
}

/**
 * Fetch results for a specific session
 */
async function fetchSessionResults(sessionId) {
    try {
        const res = await fetch(`${AppState.API_URL}/results/${sessionId}`);
        const data = await res.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch session results:', error);
        return null;
    }
}

/**
 * Check backend status
 */
async function fetchBackendStatus() {
    try {
        const res = await fetch(`${AppState.API_URL}/status`);
        const data = await res.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch backend status:', error);
        return null;
    }
}

/**
 * Start a new recording session
 */
async function apiStartSession(title) {
    try {
        const res = await fetch(`${AppState.API_URL}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: title })
        });
        return res.ok;
    } catch (error) {
        console.error('Failed to start session:', error);
        return false;
    }
}

/**
 * Stop the current recording session
 */
async function apiStopSession() {
    try {
        const res = await fetch(`${AppState.API_URL}/stop`, {
            method: 'POST'
        });
        return res.ok;
    } catch (error) {
        console.error('Failed to stop session:', error);
        return false;
    }
}

/**
 * Delete a session
 */
async function apiDeleteSession(sessionId) {
    try {
        const res = await fetch(`${AppState.API_URL}/sessions/${sessionId}`, {
            method: 'DELETE'
        });
        return res.ok;
    } catch (error) {
        console.error('Failed to delete session:', error);
        return false;
    }
}

/**
 * Application initialization
 * Called once when page loads
 */
async function appInitialize() {
    initializeDOM();

    // Check backend status
    const status = await fetchBackendStatus();
    if (status && status.is_recording) {
        updateUIForRecording(true);
    }

    // If we're on the dashboard page, load sessions
    if (window.location.pathname === '/' || window.location.pathname.includes('dashboard.html')) {
        await loadAndDisplaySessions();
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appInitialize);
} else {
    appInitialize();
}
