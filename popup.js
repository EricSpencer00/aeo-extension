let allQueries = [];
let activeFilters = new Set();
let searchTerm = '';

// ── Controls ──────────────────────────────────────────────────────────────

document.getElementById('clearBtn').addEventListener('click', () => {
  if (confirm('Clear all captured queries?')) {
    chrome.storage.local.set({ queries: [] });
    allQueries = [];
    render();
  }
});
document.getElementById('exportBtn').addEventListener('click', exportCSV);
document.getElementById('searchInput').addEventListener('input', e => {
  searchTerm = e.target.value.toLowerCase().trim();
  render();
});

// ── Helpers ───────────────────────────────────────────────────────────────

function esc(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function highlight(text, term) {
  if (!term) return esc(text);
  const e = esc(text);
  const re = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return e.replace(new RegExp(`(${re})`, 'gi'), '<mark>$1</mark>');
}

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  if (d < 604800) return `${Math.floor(d/86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }

function dayLabel(ts) {
  const today = new Date(), yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (dayKey(ts) === dayKey(today)) return 'Today';
  if (dayKey(ts) === dayKey(yest)) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' });
}

const SOURCE_COLORS = {
  'ChatGPT':          '#059669',
  'Claude':           '#ea580c',
  'Perplexity':       '#2563eb',
  'Google Gemini':    '#dc2626',
  'Microsoft Copilot':'#0284c7',
};
function srcColor(s) { return SOURCE_COLORS[s] || '#52525b'; }

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

// ── Filter + render ───────────────────────────────────────────────────────

function getFiltered() {
  let list = allQueries;
  if (activeFilters.size > 0) list = list.filter(q => activeFilters.has(q.source));
  if (searchTerm) list = list.filter(q =>
    q.query.toLowerCase().includes(searchTerm) ||
    (q.userQuery || '').toLowerCase().includes(searchTerm) ||
    q.source.toLowerCase().includes(searchTerm)
  );
  return list;
}

function render() {
  updateFilters();
  renderFeed();
}

function renderFeed() {
  const feed = document.getElementById('feed');
  const filtered = getFiltered().slice().reverse();

  if (filtered.length === 0) {
    const noData = !allQueries.length;
    feed.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${noData ? '🤖' : '🔍'}</div>
        <h3>${noData ? 'No queries yet' : 'No matches'}</h3>
        <p>${noData
          ? 'Open ChatGPT, Claude, Perplexity, or Gemini<br>and ask something to start capturing.'
          : searchTerm ? `Nothing matches "<strong>${esc(searchTerm)}</strong>"` : 'Try a different filter.'
        }</p>
      </div>`;
    return;
  }

  // group by day
  const groups = [];
  const map = {};
  for (const q of filtered) {
    const k = dayKey(q.timestamp);
    if (!map[k]) { map[k] = { label: dayLabel(q.timestamp), items: [] }; groups.push(map[k]); }
    map[k].items.push(q);
  }

  let html = '';
  for (const g of groups) {
    html += `<div class="day-label">${g.label}</div>`;
    for (const q of g.items) {
      const safe = esc(q.query).replace(/'/g, '&#39;');
      const isWeb = !!q.webSearch;

      html += `
        <div class="card${isWeb ? ' is-web' : ''}">
          <div class="card-top">
            <span class="source-badge" style="background:${srcColor(q.source)}">${q.source}</span>
            ${isWeb ? `<span class="web-badge">🔍 web search</span>` : ''}
          </div>

          <div class="card-query">${highlight(q.query, searchTerm)}</div>

          ${isWeb && q.userQuery ? `
            <div class="card-context">
              <span class="context-label">You asked:</span>
              <span class="context-text">${highlight(q.userQuery, searchTerm)}</span>
            </div>` : ''}

          <div class="card-footer">
            <span class="card-time">${timeAgo(q.timestamp)}</span>
            <button class="copy-btn" onclick="copyQ(this,'${safe}')">Copy</button>
          </div>
        </div>`;
    }
  }
  feed.innerHTML = html;
}

function updateFilters() {
  const sources = [...new Set(allQueries.map(q => q.source))];
  const counts = {};
  allQueries.forEach(q => { counts[q.source] = (counts[q.source] || 0) + 1; });

  document.getElementById('filterContainer').innerHTML = sources.map(src => {
    const on = activeFilters.has(src);
    const c = srcColor(src);
    return `<button class="chip" onclick="toggleFilter('${src}')"
      style="border-color:${c};color:${on?'#fff':c};background:${on?c:'#fff'}">
      ${src} <span style="opacity:.65;font-size:10px;font-weight:400">${counts[src]}</span>
    </button>`;
  }).join('');

  updateStats();
}

function updateStats() {
  const todayK = dayKey(Date.now());
  const counts = {};
  allQueries.forEach(q => { counts[q.source] = (counts[q.source] || 0) + 1; });
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1])[0];

  document.getElementById('statTotal').textContent = allQueries.length;
  document.getElementById('statWeb').textContent   = allQueries.filter(q => q.webSearch).length;
  document.getElementById('statToday').textContent = allQueries.filter(q => dayKey(q.timestamp) === todayK).length;
  document.getElementById('statTop').textContent   = top ? top[0].split(' ')[0] : '—';
}

// ── Actions ───────────────────────────────────────────────────────────────

function toggleFilter(src) {
  activeFilters.has(src) ? activeFilters.delete(src) : activeFilters.add(src);
  render();
}

function copyQ(btn, text) {
  navigator.clipboard.writeText(text.replace(/&#39;/g, "'")).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    toast('Copied to clipboard');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
  });
}

function exportCSV() {
  if (!allQueries.length) { toast('Nothing to export'); return; }
  let csv = 'Source,Query,User Query,Web Search,Timestamp\n';
  allQueries.forEach(q => {
    const query = `"${q.query.replace(/"/g,'""')}"`;
    const uq = `"${(q.userQuery||'').replace(/"/g,'""')}"`;
    csv += `${q.source},${query},${uq},${q.webSearch?'yes':'no'},${new Date(q.timestamp).toISOString()}\n`;
  });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], {type:'text/csv'})),
    download: `aeo-queries-${new Date().toISOString().split('T')[0]}.csv`
  });
  a.click();
  toast('Exported!');
}

// ── Storage ───────────────────────────────────────────────────────────────

chrome.storage.local.get('queries', r => {
  allQueries = r.queries || [];
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.queries) {
    allQueries = changes.queries.newValue || [];
    render();
  }
});
