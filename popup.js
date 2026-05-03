let allQueries = [];
let activeFilters = new Set();

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear all captured queries?')) {
    chrome.storage.local.set({ queries: [] });
    allQueries = [];
    renderQueries();
  }
});

document.getElementById('exportBtn').addEventListener('click', exportCSV);
document.getElementById('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function formatTime(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getSourceColor(source) {
  const colors = {
    'ChatGPT': '#10a981',
    'Claude': '#f97316',
    'Perplexity': '#3b82f6',
    'Google Gemini': '#ea4335',
    'Microsoft Copilot': '#00a4ef',
    'Unknown': '#999'
  };
  return colors[source] || colors['Unknown'];
}

function renderQueries() {
  const content = document.getElementById('content');

  let filtered = allQueries;
  if (activeFilters.size > 0) {
    filtered = allQueries.filter(q => activeFilters.has(q.source));
  }

  if (filtered.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <p>${activeFilters.size > 0 ? 'No queries for selected filters' : 'No queries captured yet'}</p>
        <p style="font-size: 11px;">Open an AI chat interface and ask a question to see queries.</p>
      </div>
    `;
    return;
  }

  content.innerHTML = filtered.reverse().map(query => `
    <div class="query-item">
      <div class="query-source" style="background: ${getSourceColor(query.source)}">${query.source}</div>
      <div class="query-text">${escapeHtml(query.query)}</div>
      <div class="query-meta">
        <span class="query-time">${formatTime(query.timestamp)}</span>
        <button class="copy-btn" onclick="copyToClipboard('${escapeHtml(query.query).replace(/'/g, "\\'")}')">Copy</button>
      </div>
    </div>
  `).join('');
}

function updateFilters() {
  const sources = [...new Set(allQueries.map(q => q.source))];
  const filterContainer = document.getElementById('filterContainer');

  filterContainer.innerHTML = sources.map(source => `
    <button class="filter-tag ${activeFilters.has(source) ? 'active' : ''}"
            onclick="toggleFilter('${source}')"
            style="border-color: ${getSourceColor(source)}; color: ${activeFilters.has(source) ? 'white' : getSourceColor(source)}; background: ${activeFilters.has(source) ? getSourceColor(source) : 'white'}">
      ${source}
    </button>
  `).join('');

  updateStats();
}

function toggleFilter(source) {
  if (activeFilters.has(source)) {
    activeFilters.delete(source);
  } else {
    activeFilters.add(source);
  }
  updateFilters();
  renderQueries();
}

function updateStats() {
  document.getElementById('totalCount').textContent = allQueries.length;

  const breakdown = {};
  allQueries.forEach(q => {
    breakdown[q.source] = (breakdown[q.source] || 0) + 1;
  });

  const breakdownHtml = Object.entries(breakdown)
    .map(([source, count]) => `<span style="margin-right: 12px;"><strong>${source}:</strong> ${count}</span>`)
    .join('');

  document.getElementById('sourceBreakdown').innerHTML = breakdownHtml;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Copied to clipboard!');
  });
}

function exportCSV() {
  if (allQueries.length === 0) {
    alert('No queries to export');
    return;
  }

  let csv = 'Source,Query,Timestamp\n';
  allQueries.forEach(q => {
    const query = `"${q.query.replace(/"/g, '""')}"`;
    const date = new Date(q.timestamp).toISOString();
    csv += `${q.source},${query},${date}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aeo-queries-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

chrome.storage.local.get('queries', (result) => {
  allQueries = result.queries || [];
  updateFilters();
  renderQueries();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.queries) {
    allQueries = changes.queries.newValue || [];
    updateFilters();
    renderQueries();
  }
});
