let allQueries = [];
let activeFilters = new Set();
let searchTerm = '';

// ── Controls ─────────────────────────────────────────────────────────────────

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear all captured queries?')) {
    chrome.storage.local.set({ queries: [] });
    allQueries = [];
    renderAll();
  }
});

document.getElementById('exportBtn').addEventListener('click', exportCSV);

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value.toLowerCase().trim();
  renderAll();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function highlightMatch(text, term) {
  if (!term) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(`(${escapedTerm})`, 'gi'), '<mark>$1</mark>');
}

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

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(ts) === dayKey(today)) return 'Today';
  if (dayKey(ts) === dayKey(yesterday)) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function getSourceColor(source) {
  const colors = {
    'ChatGPT': '#10a981',
    'Claude': '#f97316',
    'Perplexity': '#3b82f6',
    'Google Gemini': '#ea4335',
    'Microsoft Copilot': '#00a4ef',
    'Unknown': '#6b7280'
  };
  return colors[source] || colors['Unknown'];
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ── Filtered list ─────────────────────────────────────────────────────────────

function getFiltered() {
  let list = allQueries;
  if (activeFilters.size > 0) {
    list = list.filter(q => activeFilters.has(q.source));
  }
  if (searchTerm) {
    list = list.filter(q =>
      q.query.toLowerCase().includes(searchTerm) ||
      q.source.toLowerCase().includes(searchTerm)
    );
  }
  return list;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderAll() {
  updateFilters();
  renderQueries();
}

function renderQueries() {
  const content = document.getElementById('content');
  const filtered = getFiltered().slice().reverse();

  if (filtered.length === 0) {
    const icon = (searchTerm || activeFilters.size > 0) ? '🔍' : '🤖';
    const title = searchTerm ? 'No matches found'
      : activeFilters.size > 0 ? 'No queries for selected sources'
      : 'No queries captured yet';
    const body = searchTerm
      ? `No queries match "<strong>${escapeHtml(searchTerm)}</strong>"`
      : activeFilters.size > 0 ? 'Try selecting a different source filter.'
      : 'Open ChatGPT, Claude, Perplexity, or Gemini<br>and ask a question to start capturing.';

    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${icon}</div>
        <h3>${title}</h3>
        <p>${body}</p>
      </div>
    `;
    return;
  }

  // Group by day
  const groups = [];
  const groupMap = {};
  for (const q of filtered) {
    const k = dayKey(q.timestamp);
    if (!groupMap[k]) {
      const g = { label: dayLabel(q.timestamp), items: [] };
      groupMap[k] = g;
      groups.push(g);
    }
    groupMap[k].items.push(q);
  }

  let html = '';
  for (const g of groups) {
    html += `<div class="date-group-label">${g.label}</div>`;
    for (const q of g.items) {
      const safeQuery = escapeHtml(q.query).replace(/'/g, '&#39;');
      html += `
        <div class="query-item">
          <div class="query-header">
            <span class="query-source" style="background:${getSourceColor(q.source)}">${q.source}</span>
            ${q.webSearch ? '<span class="web-badge">🔍 web search</span>' : ''}
          </div>
          <div class="query-text">${highlightMatch(q.query, searchTerm)}</div>
          <div class="query-footer">
            <span class="query-time">${formatTime(q.timestamp)}</span>
            <button class="copy-btn" onclick="copyQuery(this, '${safeQuery}')">Copy</button>
          </div>
        </div>
      `;
    }
  }
  content.innerHTML = html;
}

function updateFilters() {
  const sources = [...new Set(allQueries.map(q => q.source))];
  const counts = {};
  allQueries.forEach(q => { counts[q.source] = (counts[q.source] || 0) + 1; });

  document.getElementById('filterContainer').innerHTML = sources.map(source => {
    const active = activeFilters.has(source);
    const color = getSourceColor(source);
    return `
      <button class="filter-tag" onclick="toggleFilter('${source}')"
              style="border-color:${color};color:${active ? 'white' : color};background:${active ? color : 'white'}">
        ${source} <span style="opacity:0.65;font-size:10px">${counts[source]}</span>
      </button>
    `;
  }).join('');

  updateStats();
}

function updateStats() {
  const todayK = dayKey(Date.now());
  const counts = {};
  allQueries.forEach(q => { counts[q.source] = (counts[q.source] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('totalCount').textContent = allQueries.length;
  document.getElementById('webSearchCount').textContent = allQueries.filter(q => q.webSearch).length;
  document.getElementById('todayCount').textContent = allQueries.filter(q => dayKey(q.timestamp) === todayK).length;
  document.getElementById('topSourceName').textContent = top ? top[0].split(' ')[0] : '—';
}

// ── Actions ───────────────────────────────────────────────────────────────────

function toggleFilter(source) {
  activeFilters.has(source) ? activeFilters.delete(source) : activeFilters.add(source);
  renderAll();
}

function copyQuery(btn, text) {
  const decoded = text.replace(/&#39;/g, "'");
  navigator.clipboard.writeText(decoded).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    showToast('Copied to clipboard');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 1500);
  });
}

function exportCSV() {
  if (allQueries.length === 0) {
    showToast('No queries to export');
    return;
  }
  let csv = 'Source,Query,Web Search,Timestamp\n';
  allQueries.forEach(q => {
    const query = `"${q.query.replace(/"/g, '""')}"`;
    csv += `${q.source},${query},${q.webSearch ? 'yes' : 'no'},${new Date(q.timestamp).toISOString()}\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aeo-queries-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported!');
}

// ── Storage ───────────────────────────────────────────────────────────────────

chrome.storage.local.get('queries', (result) => {
  allQueries = result.queries || [];
  renderAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.queries) {
    allQueries = changes.queries.newValue || [];
    renderAll();
  }
});
