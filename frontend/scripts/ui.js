/**
 * UI Module - Handles all UI interactions and view management
 * Depends on: api.js, charts.js
 */

// Store the session ID that is currently being processed
window.processingSessionId = null;
let statusPollInterval = null;
let recordingInterval = null;
let recordingStartTime = null;

// Use a promise-based lock for loading sessions
let loadSessionsPromise = null;
let loadSessionsLock = false; // Atomic flag: true if currently loading
let loadCount = 0; // Track how many times function is called

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} - Escaped string safe for HTML insertion
 */
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

/**
 * Load and display sessions on dashboard
 * - Only shows sessions that have ended (end_time is not null)
 * - Shows "Processing..." for sessions that are being processed
 */
async function loadAndDisplaySessions() {
    loadCount++;
    const currentCall = loadCount;
    console.log(`[loadSessions] Call #${currentCall} started`);

    // Atomic check-and-set for the lock
    if (loadSessionsLock) {
        console.log(`[loadSessions] Call #${currentCall}: Already loading (lock=true), waiting for existing promise...`);
        if (loadSessionsPromise) {
            return loadSessionsPromise;
        }
        return; // No promise to wait for
    }

    // Acquire lock
    loadSessionsLock = true;
    console.log(`[loadSessions] Call #${currentCall}: Acquired lock, starting load...`);

    // Create the promise
    loadSessionsPromise = (async () => {
        try {
            const sessions = await fetchSessions();
            const sessionList = AppState.elements.sessionList;

            if (!sessionList) {
                console.error('[loadSessions] sessionList element not found');
                return;
            }

            // Build HTML string to avoid duplicate appends
            let html = '';
            let sessionCount = 0;
            let isProcessing = false;

            if (!sessions || sessions.length === 0) {
                html = `<div class="empty-state">No study sessions yet. Start your first one above!</div>`;
            } else {
                // Fetch backend status to check if processing
                const status = await fetchBackendStatus();
                isProcessing = status && status.is_processing;

                // If backend is processing but we don't know which session, try to figure it out
                if (isProcessing && !window.processingSessionId) {
                    const recentSession = sessions.find(s => s.end_time);
                    if (recentSession) {
                        window.processingSessionId = recentSession.id;
                        console.log(`[loadSessions] Detected processing session: ${recentSession.id}`);
                        startStatusPolling();
                    }
                }

                // Track rendered session IDs to avoid duplicates
                const renderedIds = new Set();

                sessions.forEach(s => {
                    // Skip sessions that are still recording (no end_time)
                    if (!s.end_time) {
                        console.log(`[loadSessions] Skipping session ${s.id} (no end_time)`);
                        return;
                    }

                    // Avoid duplicates: if this session ID already rendered, skip
                    if (renderedIds.has(s.id)) {
                        console.warn(`[loadSessions] Duplicate session ID detected and skipped: ${s.id}`);
                        return;
                    }
                    renderedIds.add(s.id);
                    sessionCount++;
                    console.log(`[loadSessions] Rendering session ${s.id} (${s.title})`);

                    // Format duration
                    let duration = "0 min";
                    if (s.end_time) {
                        const mins = Math.round((new Date(s.end_time) - new Date(s.start_time)) / 60000);
                        duration = mins > 0 ? `${mins} min` : `< 1 min`;
                    }

                    const displayTitle = s.title || `Session #${s.id}`;

                    // Check if this session is being processed
                    const isThisProcessing = isProcessing && window.processingSessionId === s.id;

                    if (isThisProcessing) {
                        // Processing state - unclickable with processing indicator
                        // Use escapeHTML for user-generated data
                        const escapedTitle = escapeHTML(displayTitle);
                        const escapedDate = escapeHTML(new Date(s.start_time).toLocaleDateString());
                        const escapedTime = escapeHTML(new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

                        html += `
                            <div class="session-card" style="opacity: 0.6; cursor: not-allowed;" data-session-id="${s.id}">
                                <div class="card-header">
                                    <div class="card-title">${escapedTitle}</div>
                                </div>
                                <div style="margin-bottom: 1rem;" class="card-date">
                                    ${escapedDate} at ${escapedTime}
                                </div>
                                <div class="card-footer">
                                    <span class="chip">${duration}</span>
                                    <span class="chip">Processing...</span>
                                    <div class="spinner" style="width: 16px; height: 16px; border: 2px solid #f3f3f3; border-top: 2px solid var(--primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                                </div>
                            </div>
                        `;
                    } else {
                        // Normal state - clickable
                        // Use escapeHTML for user-generated data
                        const escapedTitle = escapeHTML(displayTitle);
                        const escapedDate = escapeHTML(new Date(s.start_time).toLocaleDateString());
                        const escapedTime = escapeHTML(new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

                        // Use a safe onclick handler that doesn't embed data in the HTML string
                        html += `
                            <div class="session-card" data-session-id="${s.id}" data-session-title="${encodeURIComponent(displayTitle)}" data-session-start="${encodeURIComponent(s.start_time)}">
                                <div class="card-header">
                                    <div class="card-title">${escapedTitle}</div>
                                </div>
                                <div style="margin-bottom: 1rem;" class="card-date">
                                    ${escapedDate} at ${escapedTime}
                                </div>
                                <div class="card-footer">
                                    <span class="chip">${duration}</span>
                                    <span class="chip">ID: ${s.id}</span>
                                    <button class="delete-btn" onclick="event.stopPropagation(); goToDeleteConfirmation(${s.id}, event)">
                                        <span class="material-symbols-rounded">delete</span>
                                    </button>
                                </div>
                            </div>
                        `;
                    }
                });
            }

            // Set innerHTML ONCE (prevents duplicate appends)
            console.log(`[loadSessions] Call #${currentCall}: Setting innerHTML with ${sessionCount} sessions`);
            sessionList.innerHTML = html;

            // Now attach click handlers safely using addEventListener
            if (!isProcessing) {
                sessionList.querySelectorAll('.session-card[data-session-id]').forEach(card => {
                    const sessionId = card.dataset.sessionId;
                    const title = decodeURIComponent(card.dataset.sessionTitle || '');
                    const startTime = decodeURIComponent(card.dataset.sessionStart || '');

                    card.style.cursor = 'pointer';
                    card.onclick = () => goToDetails(sessionId, title, startTime);
                });
            }

        } catch (e) {
            const sessionList = AppState.elements.sessionList;
            if (sessionList) {
                sessionList.innerHTML = `<div class="empty-state">Failed to load sessions. Is the backend running?</div>`;
            }
            console.error('[loadSessions] Error:', e);
        } finally {
            // Release lock
            loadSessionsLock = false;
            loadSessionsPromise = null;
            console.log(`[loadSessions] Call #${currentCall}: Released lock`);
        }
    })();

    return loadSessionsPromise;
}

/**
 * Navigate to dashboard
 */
function goToDashboard() {
    window.location.href = '/';
}

/**
 * Navigate to session details
 */
function goToDetails(sessionId, title, startTime) {
    window.location.href = `/details.html?sessionId=${sessionId}&title=${encodeURIComponent(title || `Session #${sessionId}`)}&startTime=${encodeURIComponent(startTime)}`;
}

/**
 * Navigate to delete confirmation page
 */
function goToDeleteConfirmation(sessionId, event) {
    if (event) {
        event.stopPropagation();
    }
    window.location.href = `/delete-confirmation.html?sessionId=${sessionId}`;
}

/**
 * Initialize details page
 */
async function initializeDetailsPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');
    const title = urlParams.get('title');
    const startTime = urlParams.get('startTime');

    // Set session details
    const detailTitle = document.getElementById('detailTitle');
    const detailDate = document.getElementById('detailDate');
    const sessionSelector = document.getElementById('sessionSelector');

    let selectedSessionId = sessionId;
    let sessions = [];

    try {
        sessions = await fetchSessions();
    } catch (e) {
        console.error('[initializeDetailsPage] Failed to fetch sessions:', e);
    }

    const endedSessions = sessions.filter(s => s.end_time);
    if (!selectedSessionId && endedSessions.length > 0) {
        selectedSessionId = String(endedSessions[0].id);
    }

    if (!selectedSessionId) {
        console.error('No session ID provided');
        return;
    }

    const applySessionDetails = (session) => {
        if (!session) return;
        if (detailTitle) {
            detailTitle.textContent = session.title ? session.title : `Session #${session.id}`;
        }
        if (detailDate && session.start_time) {
            detailDate.textContent = new Date(session.start_time).toLocaleString();
        }
    };

    const selectedSession = endedSessions.find(s => String(s.id) === String(selectedSessionId));
    if (selectedSession) {
        applySessionDetails(selectedSession);
    } else {
        if (detailTitle) {
            detailTitle.textContent = decodeURIComponent(title || '') || `Session #${selectedSessionId}`;
        }
        if (detailDate && startTime) {
            detailDate.textContent = new Date(decodeURIComponent(startTime)).toLocaleString();
        }
    }

    if (sessionSelector) {
        const optionsHtml = endedSessions.map(s => {
            const label = escapeHTML(s.title ? s.title : `Session #${s.id}`);
            return `<option value="${s.id}">${label}</option>`;
        }).join('');
        sessionSelector.innerHTML = optionsHtml;
        sessionSelector.value = String(selectedSessionId);

        sessionSelector.onchange = async () => {
            const newSessionId = sessionSelector.value;
            const nextSession = endedSessions.find(s => String(s.id) === String(newSessionId));
            if (nextSession) {
                applySessionDetails(nextSession);
                const newUrl = `/details.html?sessionId=${newSessionId}&title=${encodeURIComponent(nextSession.title || `Session #${nextSessionId}`)}&startTime=${encodeURIComponent(nextSession.start_time || '')}`;
                window.history.replaceState({}, '', newUrl);
            }
            if (typeof fetchAndRenderChart === 'function') {
                await fetchAndRenderChart(newSessionId);
            }
        };
    }

    // Load chart data
    if (typeof fetchAndRenderChart === 'function') {
        await fetchAndRenderChart(selectedSessionId);
    }
}

/**
 * Initialize delete confirmation page
 */
function initializeDeleteConfirmationPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');

    if (!sessionId) {
        console.error('No session ID provided');
        return;
    }

    // Set confirmation message
    const confirmTitle = document.getElementById('confirmTitle');
    const confirmMessage = document.getElementById('confirmMessage');

    if (confirmTitle) {
        // Use textContent for safe rendering
        confirmTitle.textContent = `Delete Session #${sessionId}`;
    }
    if (confirmMessage) {
        confirmMessage.textContent = `Are you sure you want to delete session #${sessionId}? This action cannot be undone.`;
    }

    // Store session ID for deletion
    window.sessionToDelete = sessionId;
}

/**
 * Confirm delete operation
 */
async function confirmDelete() {
    if (window.sessionToDelete) {
        const success = await apiDeleteSession(window.sessionToDelete);
        if (success) {
            alert('Session deleted successfully');
            goToDashboard();
        } else {
            alert('Failed to delete session');
        }
    }
}

/**
 * Show new session modal
 */
function showNewSessionModal() {
    const modal = document.getElementById('newSessionModal');
    const input = document.getElementById('sessionNameInput');
    if (modal) {
        modal.style.display = 'flex';
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

/**
 * Close modal when clicking on overlay (but not on modal content)
 */
function closeModalOnOverlay(event) {
    const modal = document.getElementById('newSessionModal');
    // Only close if clicking directly on the overlay
    if (event.target === modal) {
        cancelNewSession();
    }
}

/**
 * Cancel new session - close modal and clear input
 */
function cancelNewSession() {
    const modal = document.getElementById('newSessionModal');
    const input = document.getElementById('sessionNameInput');
    if (modal) {
        modal.style.display = 'none';
    }
    if (input) {
        input.value = '';
    }
}

// Flag to prevent double-clicks on confirm
let isConfirmingSession = false;

/**
 * Confirm new session - start session with entered title
 */
async function confirmNewSession() {
    if (isConfirmingSession) {
        console.log('[confirmNewSession] Already confirming, skipping...');
        return;
    }

    const input = document.getElementById('sessionNameInput');
    if (!input) return;

    const title = input.value.trim();
    const sessionTitle = title || 'Untitled Study Session';

    // Get references to buttons
    const newSessionBtn = document.getElementById('newSessionBtn');
    const stopBtn = document.getElementById('stopBtn');

    try {
        isConfirmingSession = true;

        if (newSessionBtn) {
            newSessionBtn.disabled = true;
        }

        const result = await apiStartSession(sessionTitle);

        if (result && result.ok) {
            // Close modal and clear input
            const modal = document.getElementById('newSessionModal');
            if (modal) {
                modal.style.display = 'none';
            }
            input.value = '';

            // Update UI for recording state
            if (newSessionBtn) {
                newSessionBtn.style.display = 'none';
            }
            if (stopBtn) {
                stopBtn.style.display = 'flex';
            }
            updateStatusBadge(true);
            AppState.isRecording = true;

            recordingStartTime = Date.now();
            if (recordingInterval) {
                clearInterval(recordingInterval);
            }
            recordingInterval = setInterval(() => {
                const now = Date.now();
                const elapsedMs = now - recordingStartTime;
                const totalSeconds = Math.floor(elapsedMs / 1000);
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;
                const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                const timerEl = document.getElementById('sessionTimer');
                if (timerEl) {
                    timerEl.textContent = formatted;
                }
            }, 1000);

            // Don't reload sessions list while recording
            // Sessions should only appear after stopping
        } else {
            alert("Failed to start recording.");
        }
    } catch (e) {
        console.error('[confirmNewSession] Error:', e);
        alert("Error starting session.");
    } finally {
        if (newSessionBtn) {
            newSessionBtn.disabled = false;
        }
        isConfirmingSession = false;
    }
}

/**
 * Stop the current recording session
 */
async function stopSession() {
    if (recordingInterval) {
        clearInterval(recordingInterval);
        recordingInterval = null;
    }
    recordingStartTime = null;
    const timerEl = document.getElementById('sessionTimer');
    if (timerEl) {
        timerEl.textContent = '00:00:00';
    }

    const stopBtn = document.getElementById('stopBtn');
    const newSessionBtn = document.getElementById('newSessionBtn');

    try {
        if (stopBtn) {
            stopBtn.disabled = true;
        }

        const result = await apiStopSession();

        if (result && result.ok) {
            // Set the processing session ID
            window.processingSessionId = result.sessionId;

            // Update UI
            if (stopBtn) {
                stopBtn.style.display = 'none';
            }
            if (newSessionBtn) {
                newSessionBtn.style.display = 'flex';
                newSessionBtn.disabled = false;
            }
            updateStatusBadge(false);
            AppState.isRecording = false;

            // Reload sessions list to show the stopped session with "Processing..." state
            await loadAndDisplaySessions();

            // Start polling for processing completion
            startStatusPolling();
        } else {
            if (stopBtn) {
                stopBtn.disabled = false;
            }
            alert("Failed to stop recording.");
        }
    } catch (e) {
        if (stopBtn) {
            stopBtn.disabled = false;
        }
        console.error('[stopSession] Error:', e);
    }
}

/**
 * Start polling backend status to detect when processing is complete
 */
function startStatusPolling() {
    // Clear any existing interval
    if (statusPollInterval) {
        clearInterval(statusPollInterval);
    }

    statusPollInterval = setInterval(async () => {
        try {
            const status = await fetchBackendStatus();
            if (status && !status.is_processing) {
                // Processing complete
                clearInterval(statusPollInterval);
                statusPollInterval = null;
                window.processingSessionId = null;

                // Reload sessions list to show normal state
                await loadAndDisplaySessions();
            }
        } catch (e) {
            console.error('[polling] Error:', e);
        }
    }, 2000); // Poll every 2 seconds
}

/**
 * Update the global status badge
 */
function updateStatusBadge(isRecording) {
    const badge = AppState.elements.globalStatus;
    if (!badge) return;

    if (isRecording) {
        badge.textContent = 'Recording Live';
        badge.className = 'status-badge recording';
    } else {
        badge.textContent = 'System Ready';
        badge.className = 'status-badge';
    }
}

/**
 * Update UI for recording state (called during initialization)
 */
function updateUIForRecording(isRecording) {
    AppState.isRecording = isRecording;
    const newSessionBtn = document.getElementById('newSessionBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (isRecording) {
        if (newSessionBtn) {
            newSessionBtn.style.display = 'none';
        }
        if (stopBtn) {
            stopBtn.style.display = 'flex';
        }
        updateStatusBadge(true);
    } else {
        if (stopBtn) {
            stopBtn.style.display = 'none';
        }
        if (newSessionBtn) {
            newSessionBtn.style.display = 'flex';
        }
        updateStatusBadge(false);
    }
}

// Add CSS animation for spinner
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

// Page-specific initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('[init] DOMContentLoaded fired');
    initializeDOM();

    const pathname = window.location.pathname;

    if (pathname.includes('details.html')) {
        initializeDetailsPage();
    } else if (pathname.includes('delete-confirmation.html')) {
        initializeDeleteConfirmationPage();
    } else if (pathname === '/' || pathname.includes('dashboard.html')) {
        // Dashboard page - load sessions
        loadAndDisplaySessions();
    }
});

// Handle bfcache (back-forward cache) - force reload if page is loaded from cache
window.addEventListener('pageshow', function(event) {
    if (event.persisted) {
        console.log('[init] Page loaded from bfcache, forcing reload...');
        window.location.reload();
    }
});

// Add random query parameter to script tags to prevent caching
(function() {
    const scripts = document.querySelectorAll('script[src]');
    scripts.forEach(script => {
        const src = script.getAttribute('src');
        if (src && !src.includes('?v=')) {
            script.setAttribute('src', src + '?v=' + Date.now());
        }
    });
})();
