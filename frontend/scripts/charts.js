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

                row.timestampStr = timestampStr;
            });
        }

        // Store chart data in AppState for switching
        AppState.chartData = { labels, engagement, confusion, frustration, rawData: data.data || [] };

        // Default to Engagement chart
        switchChart('engagement');

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

    if (type === 'engagement') {
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

    // Handle Friction Points UI mapping dynamically
    const frictionList = document.getElementById('frictionPointsList');
    const container = frictionList ? frictionList.parentElement : null;

    if (container && frictionList) {
        frictionList.innerHTML = ''; // Clear previous content

        if (type === 'engagement') {
            container.style.display = 'none';
        } else {
            container.style.display = 'block';
            let issuesHtml = '';

            // Filter and sort the raw data
            const rawData = AppState.chartData.rawData || [];
            let sortedData = [...rawData];

            let targetKey = type === 'confusion' ? 'confusion_score' : 'frustration_score';

            // Take top points (e.g. ones > 10%)
            const relevantData = sortedData.filter(row => (row[targetKey] || 0) > 0.1);
            relevantData.sort((a, b) => (b[targetKey] || 0) - (a[targetKey] || 0));

            if (relevantData.length === 0) {
                issuesHtml = '<div class="empty-state" style="padding: 1rem;">No friction points detected yet.</div>';
            } else {
                relevantData.forEach(row => {
                    const score = (row[targetKey] || 0) * 100;
                    const issueClass = type === 'confusion' ? 'confusion' : '';
                    const labelText = type === 'confusion' ? `Confusion (${score.toFixed(0)}%)` : `Frustration (${score.toFixed(0)}%)`;

                    let contentHtml = '';
                    if (row.audio_text) {
                        const escapedAudio = escapeHTML(row.audio_text);
                        contentHtml += `<div class="issue-text"><strong>Heard:</strong> ${escapedAudio}</div>`;
                    }
                    if (row.screen_text) {
                        const screenText = row.screen_text.length > 150 ? row.screen_text.substring(0, 150) + '...' : row.screen_text;
                        const escapedScreen = escapeHTML(screenText);
                        contentHtml += `<div class="issue-text"><strong>Screen:</strong> ${escapedScreen}</div>`;
                    }
                    if (!row.audio_text && !row.screen_text) {
                        contentHtml += `<div class="issue-text">(No context captured at this peak)</div>`;
                    }

                    issuesHtml += `
                    <div class="issue-item ${issueClass}">
                        <span class="issue-time">Time: ${row.timestampStr} — ${labelText}</span>
                        ${contentHtml}
                    </div>
                    `;
                });
            }
            frictionList.innerHTML = issuesHtml;
        }
    }    if (AppState.chartInstance) {
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
