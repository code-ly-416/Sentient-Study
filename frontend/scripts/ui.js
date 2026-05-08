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

        sessionList.innerHTML = '';
        if (!sessions || sessions.length === 0) {
            sessionList.innerHTML = `<div class="empty-state">No study sessions yet. Start your first one above!</div>`;
            return;
        }

        sessions.forEach(s => {
            const card = document.createElement('div');
            card.className = 'session-card';
            card.onclick = () => showDetails(s.id, s.title, s.start_time);

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
                </div>
            `;
            sessionList.appendChild(card);
        });
    } catch (e) {
        const sessionList = AppState.elements.sessionList;
        sessionList.innerHTML = `<div class="empty-state">Failed to load sessions. Is the backend running?</div>`;
        console.error(e);
    }
}

/**
 * Show dashboard view
 */
function showDashboard() {
    AppState.elements.detailsView.classList.remove('active');
    AppState.elements.dashboardView.classList.add('active');
    destroyChart();
    loadAndDisplaySessions();
}

/**
 * Show details view for a specific session
 */
async function showDetails(id, title, dateStr) {
    AppState.elements.dashboardView.classList.remove('active');
    AppState.elements.detailsView.classList.add('active');

    document.getElementById('detailTitle').textContent = title || `Session #${id}`;
    document.getElementById('detailDate').textContent = new Date(dateStr).toLocaleString();

    await fetchAndRenderChart(id);
}

/**
 * Start a new recording session
 */
async function startSession() {
    const title = AppState.elements.nameInput.value.trim() || 'Untitled Study Session';

    try {
        AppState.elements.startBtn.disabled = true;
        const success = await apiStartSession(title);

        if (success) {
            AppState.elements.nameInput.value = '';
            AppState.elements.nameInput.disabled = true;
            AppState.elements.startBtn.style.display = 'none';
            AppState.elements.stopBtn.style.display = 'flex';
            updateStatusBadge(true);
            AppState.isRecording = true;
        } else {
            AppState.elements.startBtn.disabled = false;
            alert("Failed to start recording.");
        }
    } catch (e) {
        AppState.elements.startBtn.disabled = false;
        console.error(e);
    }
}

/**
 * Stop the current recording session
 */
async function stopSession() {
    try {
        AppState.elements.stopBtn.disabled = true;
        const success = await apiStopSession();

        if (success) {
            AppState.elements.nameInput.disabled = false;
            AppState.elements.stopBtn.style.display = 'none';
            AppState.elements.startBtn.style.display = 'flex';
            AppState.elements.startBtn.disabled = false;
            updateStatusBadge(false);
            AppState.isRecording = false;
            loadAndDisplaySessions();
        } else {
            AppState.elements.stopBtn.disabled = false;
        }
    } catch (e) {
        AppState.elements.stopBtn.disabled = false;
        console.error(e);
    }
}

/**
 * Update the global status badge
 */
function updateStatusBadge(isRecording) {
    const badge = AppState.elements.globalStatus;
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
        AppState.elements.nameInput.disabled = true;
        AppState.elements.startBtn.style.display = 'none';
        AppState.elements.stopBtn.style.display = 'flex';
        updateStatusBadge(true);
    } else {
        AppState.elements.nameInput.disabled = false;
        AppState.elements.stopBtn.style.display = 'none';
        AppState.elements.startBtn.style.display = 'flex';
        updateStatusBadge(false);
    }
}
