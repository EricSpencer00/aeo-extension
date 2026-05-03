// Receive queries forwarded by content scripts and persist them
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'QUERY_DETECTED') {
    saveQuery(message.query, message.source, message.webSearch === true);
  }
});

function saveQuery(query, source, webSearch = false) {
  if (!query || typeof query !== 'string') return;
  const q = query.trim();
  if (q.length < 2 || q.length > 1000) return;

  // Filter noise
  const noise = new Set(['undefined', 'null', 'true', 'false', '{}', '[]', '']);
  if (noise.has(q.toLowerCase())) return;
  // Skip if it looks like JSON or HTML
  if (q.startsWith('{') || q.startsWith('[') || q.startsWith('<')) return;

  chrome.storage.local.get('queries', (result) => {
    const queries = result.queries || [];

    // Deduplicate: ignore same query+source within 30s
    const now = Date.now();
    const dupe = queries.some(
      (e) => e.query === q && e.source === source && now - e.timestamp < 30000
    );
    if (dupe) return;

    queries.push({ query: q, source, timestamp: now, webSearch });

    // Cap at 500
    if (queries.length > 500) queries.shift();

    chrome.storage.local.set({ queries });
  });
}

