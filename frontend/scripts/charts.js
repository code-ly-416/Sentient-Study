/**
 * Charts Module - Handles all chart rendering and data processing
 * Depends on: api.js, Chart.js library
 */

// Chart instance - stored in AppState
// Initialize when api.js has loaded

function extractKeyTopic(rows) {
    const stopWords = new Set([
        'the', 'and', 'with', 'from', 'that', 'this', 'have', 'your', 'for',
        'not', 'are', 'was', 'but', 'you', 'has', 'had', 'use', 'using', 'about',
        'into', 'they', 'them', 'their', 'there', 'here', 'when', 'where', 'what',
        'will', 'would', 'could', 'should', 'been', 'than', 'then', 'over', 'more'
    ]);

    const counts = {};
    rows.forEach(row => {
        if (!row.screen_text) return;
        const words = row.screen_text.toLowerCase().match(/[a-z0-9]{4,}/g);
        if (!words) return;
        words.forEach(word => {
            if (stopWords.has(word)) return;
            counts[word] = (counts[word] || 0) + 1;
        });
    });

    let topWord = '';
    let topCount = 0;
    Object.entries(counts).forEach(([word, count]) => {
        if (count > topCount) {
            topWord = word;
            topCount = count;
        }
    });

    return topWord || 'N/A';
}

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

        // KPI calculations
        const avgEngagementValue = document.getElementById('avgEngagementValue');
        const avgEngagementTrend = document.getElementById('avgEngagementTrend');
        if (avgEngagementValue) {
            if (engagement.length > 0) {
                const avg = engagement.reduce((sum, value) => sum + value, 0) / engagement.length;
                avgEngagementValue.textContent = `${avg.toFixed(0)}%`;
                if (avgEngagementTrend) {
                    const delta = engagement[engagement.length - 1] - engagement[0];
                    const trendLabel = delta > 3 ? 'Trend: Up' : delta < -3 ? 'Trend: Down' : 'Trend: Stable';
                    avgEngagementTrend.textContent = trendLabel;
                }
            } else {
                avgEngagementValue.textContent = '--%';
                if (avgEngagementTrend) {
                    avgEngagementTrend.textContent = 'Trend: --';
                }
            }
        }

        const peakFrustrationValue = document.getElementById('peakFrustrationValue');
        const peakFrustrationTime = document.getElementById('peakFrustrationTime');
        if (peakFrustrationValue) {
            const rawRows = data.data || [];
            if (rawRows.length > 0) {
                const peakRow = rawRows.reduce((maxRow, row) => {
                    const rowValue = row.frustration_score || 0;
                    const maxValue = maxRow.frustration_score || 0;
                    return rowValue > maxValue ? row : maxRow;
                }, rawRows[0]);
                const peakValue = (peakRow.frustration_score || 0) * 100;
                peakFrustrationValue.textContent = `${peakValue.toFixed(0)}%`;
                if (peakFrustrationTime) {
                    peakFrustrationTime.textContent = `Time: ${peakRow.timestampStr || '--'}`;
                }
            } else {
                peakFrustrationValue.textContent = '--%';
                if (peakFrustrationTime) {
                    peakFrustrationTime.textContent = 'Time: --';
                }
            }
        }

        const keyTopicValue = document.getElementById('keyTopicValue');
        if (keyTopicValue) {
            keyTopicValue.textContent = extractKeyTopic(data.data || []);
        }

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
    const tabContainer = document.querySelector('.chart-tabs');
    document.querySelectorAll('.chart-tab').forEach(btn => btn.classList.remove('active'));
    const activeTab = document.querySelector(`.chart-tab[onclick*="${type}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    if (tabContainer) {
        tabContainer.setAttribute('data-active', type);
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
        color = '#3b82f6';
        label = 'Engagement %';
    } else if (type === 'confusion') {
        dataset = AppState.chartData.confusion;
        color = '#f59e0b';
        label = 'Confusion %';
    } else if (type === 'frustration') {
        dataset = AppState.chartData.frustration;
        color = '#ef4444';
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
