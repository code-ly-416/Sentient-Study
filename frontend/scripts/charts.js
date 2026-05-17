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

    if (!topWord) return 'N/A';
    return topWord.charAt(0).toUpperCase() + topWord.slice(1);
}

function extractChunkTopic(text) {
    const stopWords = new Set([
        'the', 'and', 'with', 'from', 'that', 'this', 'have', 'your', 'for',
        'not', 'are', 'was', 'but', 'you', 'has', 'had', 'use', 'using', 'about',
        'into', 'they', 'them', 'their', 'there', 'here', 'when', 'where', 'what',
        'will', 'would', 'could', 'should', 'been', 'than', 'then', 'over', 'more',
        'chrome', 'file', 'edit', 'view', 'history', 'bookmarks', 'tabs', 'tab',
        'window', 'help', 'search', 'address', 'settings', 'extensions', 'reload',
        'new', 'private', 'incognito', 'back', 'forward', 'home'
    ]);

    const tokens = text.match(/[A-Za-z][A-Za-z0-9_\-]{3,}/g) || [];
    const counts = {};
    tokens.forEach(token => {
        const cleaned = token.toLowerCase();
        if (cleaned.length <= 4 || stopWords.has(cleaned)) return;
        counts[cleaned] = (counts[cleaned] || 0) + (token[0] === token[0].toUpperCase() ? 2 : 1);
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (sorted.length === 0) return 'N/A';
    return sorted.map(([term]) => term.charAt(0).toUpperCase() + term.slice(1)).join(' ');
}

function buildTooltipTopic(dataIndex) {
    const rawData = AppState.chartData.rawData || [];
    const row = rawData[dataIndex] || {};
    const screenText = row.screen_text ? String(row.screen_text) : '';
    const audioText = row.audio_text ? String(row.audio_text) : '';
    const combined = `${screenText} ${audioText}`.trim();
    const topic = combined ? extractChunkTopic(combined) : 'N/A';
    return topic;
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
                    const topicSource = peakRow.screen_text || peakRow.audio_text || '';
                    const topicLabel = peakRow.topic ? peakRow.topic : (topicSource ? extractChunkTopic(String(topicSource)) : 'N/A');
                    peakFrustrationTime.textContent = `Time: ${peakRow.timestampStr || '--'} | ${topicLabel}`;
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
    const detailsLayout = document.querySelector('.details-layout');

    if (container && frictionList) {
        frictionList.innerHTML = ''; // Clear previous content

        if (type === 'engagement') {
            if (detailsLayout) {
                detailsLayout.classList.add('full-width');
            }
            container.classList.add('is-hidden');
        } else {
            if (detailsLayout) {
                detailsLayout.classList.remove('full-width');
            }
            container.classList.remove('is-hidden');
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

                    const topicLabel = row.topic ? row.topic : extractKeyTopic(row.screen_text ? [row.screen_text] : []);
                    const safeTopic = escapeHTML(topicLabel);
                    const encodedDesc = encodeURIComponent(row.description || '');
                    const encodedTime = encodeURIComponent(row.timestampStr || '--');
                    const contentHtml = `<div class="issue-text">${safeTopic}</div>`;

                    issuesHtml += `
                    <div class="issue-item ${issueClass}" data-description="${encodedDesc}" data-time="${encodedTime}">
                        <span class="issue-time">Time: ${row.timestampStr} — ${labelText}</span>
                        ${contentHtml}
                    </div>
                    `;
                });
            }
            frictionList.innerHTML = issuesHtml;

            frictionList.querySelectorAll('.issue-item').forEach(item => {
                item.addEventListener('click', () => {
                    const descText = decodeURIComponent(item.dataset.description || '').trim();
                    const timeLabel = decodeURIComponent(item.dataset.time || '--');

                    const modal = document.getElementById('contextModal');
                    const modalTime = document.getElementById('modalTimeMarker');
                    const modalDesc = document.getElementById('modalDescriptionBody');

                    if (modalTime) {
                        modalTime.textContent = `Friction Point Context — ${timeLabel}`;
                    }
                    if (modalDesc) {
                        modalDesc.textContent = descText || 'No analytical context recorded for this block.';
                    }
                    if (modal) {
                        modal.style.display = 'flex';
                    }
                });
            });
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
                pointRadius: 2,
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
                    backgroundColor: 'rgba(17, 22, 29, 0.9)',
                    padding: 12,
                    cornerRadius: 8,
                    titleFont: { size: 14, family: 'Inter' },
                    bodyFont: { size: 14, family: 'Inter' },
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                        },
                        afterLabel: function (context) {
                            return buildTooltipTopic(context.dataIndex);
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

/**
 * Session Assistant — Async streaming query handler
 */
async function executeAssistantQuery() {
    const inputEl = document.getElementById('assistantQueryInput');
    const btnEl = document.getElementById('submitQueryBtn');
    const responseArea = document.getElementById('chatResponseArea');

    if (!inputEl || !btnEl || !responseArea) return;

    const sessionId = new URLSearchParams(window.location.search).get('sessionId');
    const queryText = inputEl.value.trim();

    if (!sessionId) {
        responseArea.textContent = 'Error: No active session selected.';
        return;
    }

    if (!queryText) {
        responseArea.textContent = 'Please enter an analytical query first.';
        return;
    }

    // Lock inputs and set connecting state
    inputEl.disabled = true;
    btnEl.disabled = true;
    responseArea.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">Analyzing session telemetry — connecting to local engine...</span>';

    try {
        const resp = await fetch(`/api/query/${sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: queryText }),
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            responseArea.textContent = `Error: ${errData.detail || resp.statusText}`;
            return;
        }

        // Clear the loading text cleanly before appending stream
        responseArea.textContent = '';

        // Attach a byte stream reader to the HTTP response
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;

        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;

            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                responseArea.textContent += chunk;

                // Auto-scroll anchor logic
                responseArea.scrollTop = responseArea.scrollHeight;
            }
        }
    } catch (e) {
        responseArea.textContent += `\nNetwork error: ${e.message}`;
    } finally {
        // Unlock inputs and set focus for rapid-fire querying
        inputEl.disabled = false;
        btnEl.disabled = false;
        inputEl.value = '';
        inputEl.focus();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const submitBtn = document.getElementById('submitQueryBtn');
    const queryInput = document.getElementById('assistantQueryInput');

    if (submitBtn) {
        submitBtn.addEventListener('click', executeAssistantQuery);
    }
    if (queryInput) {
        queryInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                executeAssistantQuery();
            }
        });
    }
});
