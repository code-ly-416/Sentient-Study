/**
 * UI Module - Handles all UI interactions and view management
 * Depends on: api.js, charts.js
 */

/**
 * Load and display sessions on dashboard
 */
async function loadAndDisplaySessions() {
    try {
        const sessions = await fetchSessions();
        const sessionList = AppState.elements.sessionList;

        if (!sessionList) {
            console.error('sessionList element not found');
            return;
        }

        sessionList.innerHTML = '';
        if (!sessions || sessions.length === 0) {
            sessionList.innerHTML = `<div class="empty-state">No study sessions yet. Start your first one above!</div>`;
            return;
        }

        sessions.forEach(s => {
            const card = document.createElement('div');
            card.className = 'session-card';
            card.onclick = () => goToDetails(s.id, s.title, s.start_time);

            // Format duration if end_time exists
            let duration = "In Progress";
            if (s.end_time) {
                const mins = Math.round((new Date(s.end_time) - new Date(s.start_time)) / 60000);
                duration = mins > 0 ? `${mins} min` : `< 1 min`;
            }

            const displayTitle = s.title || `Session #${s.id}`;

            card.innerHTML = `
                <div class="card-header">
                    <div class="card-title">${displayTitle}</div>
                </div>
                <div style="margin-bottom: 1rem;" class="card-date">
                    ${new Date(s.start_time).toLocaleDateString()} at ${new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div class="card-footer">
                    <span class="chip">${duration}</span>
                    <span class="chip">ID: ${s.id}</span>
                    <button class="delete-btn" onclick="goToDeleteConfirmation(${s.id}, event); event.stopPropagation();">
                        <span class="material-symbols-rounded">delete</span>
                    </button>
                </div>
            `;
            sessionList.appendChild(card);
        });
    } catch (e) {
        const sessionList = AppState.elements.sessionList;
        if (sessionList) {
            sessionList.innerHTML = `<div class="empty-state">Failed to load sessions. Is the backend running?</div>`;
        }
        console.error(e);
    }
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

    if (!sessionId) {
        console.error('No session ID provided');
        return;
    }

    // Set session details
    const detailTitle = document.getElementById('detailTitle');
    const detailDate = document.getElementById('detailDate');

    if (detailTitle) {
        detailTitle.textContent = decodeURIComponent(title) || `Session #${sessionId}`;
    }
    if (detailDate && startTime) {
        detailDate.textContent = new Date(decodeURIComponent(startTime)).toLocaleString();
    }

    // Load chart data
    if (typeof fetchAndRenderChart === 'function') {
        await fetchAndRenderChart(sessionId);
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
 * Start a new recording session
 */
async function startSession() {
    const title = AppState.elements.nameInput ? AppState.elements.nameInput.value.trim() : '';
    const sessionTitle = title || 'Untitled Study Session';

    try {
        if (AppState.elements.startBtn) {
            AppState.elements.startBtn.disabled = true;
        }
        const success = await apiStartSession(sessionTitle);

        if (success) {
            if (AppState.elements.nameInput) {
                AppState.elements.nameInput.value = '';
                AppState.elements.nameInput.disabled = true;
            }
            if (AppState.elements.startBtn) {
                AppState.elements.startBtn.style.display = 'none';
            }
            if (AppState.elements.stopBtn) {
                AppState.elements.stopBtn.style.display = 'flex';
            }
            updateStatusBadge(true);
            AppState.isRecording = true;
        } else {
            if (AppState.elements.startBtn) {
                AppState.elements.startBtn.disabled = false;
            }
            alert("Failed to start recording.");
        }
    } catch (e) {
        if (AppState.elements.startBtn) {
            AppState.elements.startBtn.disabled = false;
        }
        console.error(e);
    }
}

/**
 * Stop the current recording session
 */
async function stopSession() {
    try {
        if (AppState.elements.stopBtn) {
            AppState.elements.stopBtn.disabled = true;
        }
        const success = await apiStopSession();

        if (success) {
            if (AppState.elements.nameInput) {
                AppState.elements.nameInput.disabled = false;
            }
            if (AppState.elements.stopBtn) {
                AppState.elements.stopBtn.style.display = 'none';
            }
            if (AppState.elements.startBtn) {
                AppState.elements.startBtn.style.display = 'flex';
                AppState.elements.startBtn.disabled = false;
            }
            updateStatusBadge(false);
            AppState.isRecording = false;
            loadAndDisplaySessions();
        } else {
            if (AppState.elements.stopBtn) {
                AppState.elements.stopBtn.disabled = false;
            }
        }
    } catch (e) {
        if (AppState.elements.stopBtn) {
            AppState.elements.stopBtn.disabled = false;
        }
        console.error(e);
    }
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
    if (isRecording) {
        if (AppState.elements.nameInput) {
            AppState.elements.nameInput.disabled = true;
        }
        if (AppState.elements.startBtn) {
            AppState.elements.startBtn.style.display = 'none';
        }
        if (AppState.elements.stopBtn) {
            AppState.elements.stopBtn.style.display = 'flex';
        }
        updateStatusBadge(true);
    } else {
        if (AppState.elements.nameInput) {
            AppState.elements.nameInput.disabled = false;
        }
        if (AppState.elements.stopBtn) {
            AppState.elements.stopBtn.style.display = 'none';
        }
        if (AppState.elements.startBtn) {
            AppState.elements.startBtn.style.display = 'flex';
        }
        updateStatusBadge(false);
    }
}

// Page-specific initialization
document.addEventListener('DOMContentLoaded', function() {
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
