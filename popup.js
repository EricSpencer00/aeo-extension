// Side panel. Reads straight from chrome.storage.local and re-renders on
// change, so queries appear while the answer is still streaming.

const view = document.getElementById('view');
const countEl = document.getElementById('count');
const filterEl = document.getElementById('filter');
const sourceEl = document.getElementById('source');
const controls = document.getElementById('controls');
const toastEl = document.getElementById('toast');

const TABS = ['timeline', 'top', 'diag'];
let tab = 'timeline';
let turns = [];
let diagnostics = [];

for (const name of TABS) {
  document.getElementById('tab-' + name).addEventListener('click', () => {
    tab = name;
    for (const other of TABS) {
      document.getElementById('tab-' + other).setAttribute('aria-selected', String(other === name));
    }
    controls.classList.toggle('hidden', name === 'diag');
    render();
  });
}

filterEl.addEventListener('input', render);
sourceEl.addEventListener('change', render);
document.getElementById('copy-all').addEventListener('click', copyAll);
document.getElementById('export-csv').addEventListener('click', exportCsv);
document.getElementById('clear').addEventListener('click', clearAll);

chrome.storage.local.get(['turns', 'diagnostics'], (d) => {
  turns = d.turns || [];
  diagnostics = d.diagnostics || [];
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.turns) turns = changes.turns.newValue || [];
  if (changes.diagnostics) diagnostics = changes.diagnostics.newValue || [];
  render();
});

// ── Filtering ───────────────────────────────────────────────────────────────
function visibleTurns() {
  const needle = filterEl.value.trim().toLowerCase();
  const src = sourceEl.value;
  return turns
    .filter((t) => !src || t.source === src)
    .map((t) => {
      if (!needle) return t;
      const promptHit = (t.prompt || '').toLowerCase().includes(needle);
      const queries = t.queries.filter((q) => q.q.toLowerCase().includes(needle));
      if (!promptHit && !queries.length) return null;
      return Object.assign({}, t, { queries: promptHit ? t.queries : queries });
    })
    .filter(Boolean)
    .slice()
    .reverse();
}

function allVisibleQueries() {
  return visibleTurns().flatMap((t) => t.queries.map((q) => q.q));
}

// ── Render ──────────────────────────────────────────────────────────────────
function render() {
  const total = turns.reduce((a, t) => a + t.queries.length, 0);
  countEl.textContent = total === 1 ? '1 query' : total + ' queries';

  view.textContent = '';
  if (tab === 'diag') return renderDiagnostics();
  if (!turns.length) return renderEmpty();

  const list = visibleTurns();
  if (!list.length) {
    view.appendChild(el('div', { class: 'empty' }, [el('p', {}, ['Nothing matches that filter.'])]));
    return;
  }
  if (tab === 'top') return renderTop(list);
  renderTimeline(list);
}

function renderTimeline(list) {
  const needle = filterEl.value.trim();
  for (const t of list) {
    const head = el('div', { class: 'turn-head' }, [
      el('div', { class: 'turn-meta' }, [
        el('span', { class: 'badge ' + cssClass(t.source) }, [t.source]),
        el('span', { class: 'time' }, [when(t.ts)]),
      ]),
      t.prompt
        ? el('div', { class: 'prompt' }, [t.prompt])
        : el('div', { class: 'prompt none' }, ['(prompt not captured)']),
    ]);

    const queries = el('ul', { class: 'queries' });
    if (t.queries.length) {
      for (const q of t.queries) {
        const btn = el('button', { class: 'copy', title: 'Copy this query' }, ['copy']);
        btn.addEventListener('click', () => copy(q.q, 'Query copied'));
        queries.appendChild(el('li', { class: 'q' }, [
          el('span', { class: 'q-text' }, highlight(q.q, needle)),
          btn,
        ]));
      }
    } else {
      queries.appendChild(el('li', { class: 'no-queries' }, ['No web search was run for this prompt.']));
    }

    view.appendChild(el('div', { class: 'turn' }, [head, queries]));
  }
}

function renderTop(list) {
  const counts = new Map();
  for (const t of list) {
    for (const q of t.queries) counts.set(q.q, (counts.get(q.q) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!ranked.length) {
    view.appendChild(el('div', { class: 'empty' }, [el('p', {}, ['No queries captured yet.'])]));
    return;
  }
  const max = ranked[0][1];
  view.appendChild(el('p', { class: 'note' }, [
    'The exact strings these assistants sent to a search engine. Rank for these.',
  ]));
  const ul = el('ul', { class: 'rank' });
  for (const [q, n] of ranked) {
    const btn = el('button', { class: 'copy', title: 'Copy' }, ['copy']);
    btn.addEventListener('click', () => copy(q, 'Query copied'));
    const bar = el('div', { class: 'bar' });
    bar.style.width = Math.max(6, Math.round((n / max) * 100)) + '%';
    ul.appendChild(el('li', {}, [
      el('span', { class: 'n' }, [String(n)]),
      el('span', { class: 't' }, [q, bar]),
      btn,
    ]));
  }
  view.appendChild(ul);
}

function renderDiagnostics() {
  const bySource = {};
  for (const t of turns) {
    bySource[t.source] = bySource[t.source] || { turns: 0, queries: 0 };
    bySource[t.source].turns++;
    bySource[t.source].queries += t.queries.length;
  }
  const rows = Object.entries(bySource);
  view.appendChild(el('p', { class: 'note' }, [
    'Everything here stays in this browser. Nothing is uploaded.',
  ]));
  if (rows.length) {
    const ul = el('ul', { class: 'rank' });
    for (const [src, s] of rows) {
      ul.appendChild(el('li', {}, [
        el('span', { class: 'badge ' + cssClass(src) }, [src]),
        el('span', { class: 't' }, [`${s.queries} quer${s.queries === 1 ? 'y' : 'ies'} across ${s.turns} prompt${s.turns === 1 ? '' : 's'}`]),
      ]));
    }
    view.appendChild(ul);
  }

  if (!diagnostics.length) {
    view.appendChild(el('p', { class: 'note' }, ['No unreadable responses recorded.']));
    return;
  }
  view.appendChild(el('p', { class: 'note' }, [
    'Responses that were tapped but contained no recognisable search queries. ' +
    'Field names only — no message content is stored. If a site changes its ' +
    'protocol, this is what shows it.',
  ]));
  for (const d of diagnostics.slice().reverse()) {
    view.appendChild(el('div', { class: 'diag' }, [
      el('div', {}, [el('span', { class: 'badge ' + cssClass(d.source) }, [d.source]), ' ', when(d.ts)]),
      el('div', { class: 'u' }, [d.url || '']),
      el('div', { class: 'k' }, [
        d.info ? `${d.info.bytes} bytes · events: ${(d.info.events || []).join(', ') || 'none'}` : '',
      ]),
      el('div', { class: 'k' }, [d.info ? (d.info.keys || []).join('  ') : '']),
    ]));
  }
}

function renderEmpty() {
  view.appendChild(el('div', { class: 'empty' }, [
    el('h2', {}, ['No queries captured yet']),
    el('p', {}, ['Ask an AI assistant something that makes it search the web.']),
    el('ol', {}, [
      el('li', {}, ['Open ChatGPT, Claude, or Perplexity.']),
      el('li', {}, ['Ask a question that needs current information.']),
      el('li', {}, ['The exact queries it sends to a search engine appear here.']),
    ]),
  ]));
}

// ── Actions ─────────────────────────────────────────────────────────────────
function copyAll() {
  const list = allVisibleQueries();
  if (!list.length) return toast('Nothing to copy');
  copy(list.join('\n'), `${list.length} queries copied`);
}

function exportCsv() {
  const rows = [['timestamp', 'source', 'prompt', 'search_query']];
  for (const t of visibleTurns()) {
    for (const q of t.queries) {
      rows.push([new Date(q.ts).toISOString(), t.source, t.prompt || '', q.q]);
    }
  }
  if (rows.length === 1) return toast('Nothing to export');
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `aeo-queries-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Exported ${rows.length - 1} rows`);
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function clearAll() {
  chrome.storage.local.set({ turns: [], diagnostics: [] }, () => {
    turns = [];
    diagnostics = [];
    render();
    toast('Cleared');
  });
}

function copy(text, msg) {
  navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('Copy failed'));
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  for (const c of children || []) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// Builds highlighted text as DOM nodes — never innerHTML, so a query string
// can't inject markup into the panel.
function highlight(text, needle) {
  if (!needle) return [text];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const out = [];
  let i = 0;
  for (;;) {
    const hit = lower.indexOf(n, i);
    if (hit === -1) { out.push(text.slice(i)); break; }
    if (hit > i) out.push(text.slice(i, hit));
    out.push(el('mark', {}, [text.slice(hit, hit + n.length)]));
    i = hit + n.length;
  }
  return out;
}

function cssClass(source) {
  return String(source || 'Unknown').replace(/[^A-Za-z]+/g, '');
}

function when(ts) {
  const d = new Date(ts);
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
