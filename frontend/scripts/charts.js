/**
 * Charts Module - Handles all chart rendering and data processing
 * Depends on: api.js, Chart.js library
 */

// Chart instance - stored in AppState
// Initialize when api.js has loaded

/**
 * Fetch and render the analytics chart for a session
 */
async function fetchAndRenderChart(sessionId) {
    try {
        const data = await fetchSessionResults(sessionId);
        if (!data) {
            console.error('No data returned from API');
            return;
        }

        const labels = [];
        const engagement = [];
        const confusion = [];
        const frustration = [];
        const flow = [];
        let issuesHtml = '';

        if (data.data && data.data.length > 0) {
            const startTs = new Date(data.data[0].timestamp).getTime();

            data.data.forEach(row => {
                const currentTs = new Date(row.timestamp).getTime();
                const diffSecs = Math.round((currentTs - startTs) / 1000);

                // Format mm:ss
                const mins = Math.floor(diffSecs / 60);
                const secs = diffSecs % 60;
                const timestampStr = `${mins}:${secs.toString().padStart(2, '0')}`;
                labels.push(timestampStr);

                // Parse values to percentages
                const e = (row.engagement_score || 0) * 100;
                const c = (row.confusion_score || 0) * 100;
                const f = (row.frustration_score || 0) * 100;

                engagement.push(e);
                confusion.push(c);
                frustration.push(f);

                // Composite "Study Flow" Score:
                // High engagement is good (+50% weight). Lack of confusion is good (+25% weight). Lack of frustration is good (+25% weight).
                // This strictly bounds the score between 0 and 100 with no negative numbers.
                let flowScore = (e * 0.5) + ((100 - c) * 0.25) + ((100 - f) * 0.25);
                flow.push(flowScore);

                // Check for friction points (threshold > 30% for demo purposes)
                if ((c > 30 || f > 30) && (row.audio_text || row.screen_text)) {
                    const isFrustration = f > c;
                    const issueClass = isFrustration ? '' : 'confusion';
                    const label = isFrustration ? `Frustration (${f.toFixed(0)}%)` : `Confusion (${c.toFixed(0)}%)`;

                    let contentHtml = '';
                    if (row.audio_text) {
                        contentHtml += `<div class="issue-text"><strong>Heard:</strong> ${row.audio_text}</div>`;
                    }
                    if (row.screen_text) {
                        // limit OCR text length for readability
                        const screenText = row.screen_text.length > 150 ? row.screen_text.substring(0, 150) + '...' : row.screen_text;
                        contentHtml += `<div class="issue-text"><strong>Screen:</strong> ${screenText}</div>`;
                    }

                    // Prepend to show newest issues first
                    issuesHtml = `
                    <div class="issue-item ${issueClass}">
                        <span class="issue-time">Time: ${timestampStr} — ${label}</span>
                        ${contentHtml}
                    </div>
                    ` + issuesHtml;
                }
            });
        }

        // Update friction points display
        const frictionList = document.getElementById('frictionPointsList');
        if (frictionList) {
            if (issuesHtml.trim() === '') {
                frictionList.innerHTML = '<div class="empty-state" style="padding: 1rem;">No friction points detected yet.</div>';
            } else {
                frictionList.innerHTML = issuesHtml;
            }
        }

        // Store chart data in AppState for switching
        AppState.chartData = { labels, engagement, confusion, frustration, flow };

        // Default to Study Flow chart
        switchChart('flow');

    } catch (e) {
        console.error("Failed to load chart data:", e);
    }
}

/**
 * Switch between different chart views
 */
function switchChart(type) {
    // Update UI tabs
    document.querySelectorAll('.chart-tab').forEach(btn => btn.classList.remove('active'));
    const activeTab = document.querySelector(`.chart-tab[onclick*="${type}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }

    const ctx = document.getElementById('analyticsChart');
    if (!ctx) {
        console.error('Canvas element not found');
        return;
    }
    const context = ctx.getContext('2d');

    let dataset = [];
    let color = '';
    let label = '';

    if (type === 'flow') {
        dataset = AppState.chartData.flow;
        color = '#0b57d0'; // Google Blue
        label = 'Study Flow Score';
    } else if (type === 'engagement') {
        dataset = AppState.chartData.engagement;
        color = '#146c2e'; // Green
        label = 'Engagement %';
    } else if (type === 'confusion') {
        dataset = AppState.chartData.confusion;
        color = '#b3261e'; // Red
        label = 'Confusion %';
    } else if (type === 'frustration') {
        dataset = AppState.chartData.frustration;
        color = '#b36b00'; // Orange
        label = 'Frustration %';
    }

    if (AppState.chartInstance) {
        AppState.chartInstance.destroy();
    }

    // Render line chart
    AppState.chartInstance = new Chart(context, {
        type: 'line',
        data: {
            labels: AppState.chartData.labels,
            datasets: [{
                label: label,
                data: dataset,
                borderColor: color,
                backgroundColor: color + '20', // Add transparency for fill
                borderWidth: 3,
                fill: true,
                tension: 0.4, // Smooth curved lines
                pointRadius: 4,
                pointHoverRadius: 6,
                pointBackgroundColor: '#fff',
                pointBorderColor: color,
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: '#e0e0e0', drawBorder: false },
                    ticks: { callback: function (value) { return value + '%'; } }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 12,
                    titleFont: { size: 14, family: 'Inter' },
                    bodyFont: { size: 14, family: 'Inter' },
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                        }
                    }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });
}

/**
 * Destroy chart instance (cleanup)
 */
function destroyChart() {
    if (AppState.chartInstance) {
        AppState.chartInstance.destroy();
        AppState.chartInstance = null;
    }
}
