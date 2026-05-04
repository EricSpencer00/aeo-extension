// Runs in PAGE context. No chrome.* API — communicates via window.postMessage only.
(function () {
  if (window.__aeoInjected) return;
  window.__aeoInjected = true;

  const _log = (...a) => console.log('[AEO]', ...a);
  const _origFetch = window.fetch;

  window.fetch = async function (...args) {
    try {
      const urlArg = args[0];
      const url = typeof urlArg === 'string' ? urlArg
        : urlArg instanceof Request ? urlArg.url
        : urlArg?.url || '';
      const opts = args[1] || {};
      const method = (opts.method || 'GET').toUpperCase();
      const body = opts.body;

      // ── ChatGPT: intercept conversation POST ────────────────────────────
      if (getSource() === 'ChatGPT' && method === 'POST' &&
          (url.includes('/backend-api/f/conversation') || url.includes('/backend-api/conversation'))) {
        _log('ChatGPT POST intercepted:', url);
        const res = await _origFetch.apply(this, args);

        // Drain the stream (so the page works), then fetch real search queries from API
        drainAndFetchChatGPT(res.clone());
        return res;
      }

      // ── Claude.ai: tap SSE stream for web_search tool calls ─────────────
      if (getSource() === 'Claude' && url.includes('/completion')) {
        _log('Claude completion intercepted:', url);
        const res = await _origFetch.apply(this, args);
        tapClaudeStream(res.clone(), body);
        return res;
      }

      // ── Perplexity: capture query_str from request body ──────────────────
      if (body && typeof body === 'string' && getSource() === 'Perplexity') {
        const q = extractPerplexityQuery(body);
        if (q) { _log('Perplexity query:', q); emitQuery(q, 'Perplexity', false); }
      }

      // ── Gemini / Copilot: generic fallback ──────────────────────────────
      if (body && typeof body === 'string') {
        const src = getSource();
        if (src === 'Google Gemini' || src === 'Microsoft Copilot') {
          const q = extractGenericQuery(body);
          if (q) { _log(src, 'query:', q); emitQuery(q, src, false); }
        }
      }
    } catch (e) { console.warn('[AEO] fetch intercept error:', e); }

    return _origFetch.apply(this, args);
  };

  // ── ChatGPT: drain stream then fetch real search queries via API ────────
  async function drainAndFetchChatGPT(clonedRes) {
    // Drain the SSE stream so the page renders normally
    try {
      const reader = clonedRes.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (_) {}

    // After stream ends, conversation ID is in the URL: /c/<id>
    // (for new conversations ChatGPT navigates there during streaming)
    // Small delay to let the URL settle
    await new Promise(r => setTimeout(r, 500));
    const convId = location.pathname.match(/\/c\/([a-f0-9-]+)/)?.[1];
    _log('ChatGPT stream done. convId from URL:', convId);
    if (!convId) return;

    try {
      const sess = await (await _origFetch('/api/auth/session')).json();
      const token = sess?.accessToken;
      if (!token) { _log('ChatGPT: no auth token'); return; }

      const conv = await (await _origFetch(`/backend-api/conversation/${convId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })).json();

      if (!conv?.mapping) { _log('ChatGPT: no mapping'); return; }

      // Collect ALL search queries across all tool messages in this conversation,
      // deduplicated — emit only ones we haven't seen yet
      const nodes = Object.values(conv.mapping);
      const found = [];
      for (const node of nodes) {
        const msg = node.message;
        if (!msg || msg.author?.role !== 'tool') continue;
        const queries = msg.metadata?.search_model_queries?.queries;
        if (Array.isArray(queries)) {
          queries.forEach(q => { if (typeof q === 'string' && q.trim().length > 1) found.push(q.trim()); });
        }
      }

      _log('ChatGPT search queries in conv:', found);
      // Emit each unique query; content.js dedupes within 30s so safe to re-emit
      const unique = [...new Set(found)];
      unique.forEach(q => emitQuery(q, 'ChatGPT', true));
    } catch (e) { _log('ChatGPT API fetch error:', e); }
  }

  // ── Claude.ai SSE tap ────────────────────────────────────────────────────
  async function tapClaudeStream(clonedRes, requestBody) {
    const webSearchQueries = [];
    let userQuery = null;
    let pendingToolName = null;
    let pendingJsonBuf = '';

    if (requestBody && typeof requestBody === 'string') {
      userQuery = extractClaudeQuery(requestBody);
    }

    try {
      const reader = clonedRes.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data) continue;
          try {
            const d = JSON.parse(data);
            if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
              pendingToolName = d.content_block.name || null;
              pendingJsonBuf = '';
            }
            if (d.type === 'content_block_delta' && d.delta?.type === 'input_json_delta') {
              pendingJsonBuf += d.delta.partial_json || '';
            }
            if (d.type === 'content_block_stop' && pendingToolName) {
              if (pendingToolName === 'web_search' && pendingJsonBuf) {
                try {
                  const input = JSON.parse(pendingJsonBuf);
                  const q = input.query || input.q || input.search_query;
                  if (typeof q === 'string' && q.trim().length > 1) {
                    _log('Claude web_search:', q);
                    webSearchQueries.push(q.trim());
                  }
                } catch (_) {}
              }
              pendingToolName = null;
              pendingJsonBuf = '';
            }
          } catch (_) {}
        }
      }
    } catch (e) { _log('Claude stream error:', e); }

    if (webSearchQueries.length > 0) {
      webSearchQueries.forEach(q => emitQuery(q, 'Claude', true));
    } else if (userQuery) {
      emitQuery(userQuery, 'Claude', false);
    }
  }

  // ── Perplexity ─────────────────────────────────────────────────────────
  function extractPerplexityQuery(bodyStr) {
    try {
      const b = JSON.parse(bodyStr);
      if (b.query_str && typeof b.query_str === 'string') return b.query_str.trim();
    } catch (_) {}
    return null;
  }

  // ── Claude user query fallback ──────────────────────────────────────────
  function extractClaudeQuery(bodyStr) {
    try {
      const b = JSON.parse(bodyStr);
      if (b.prompt && typeof b.prompt === 'string') return b.prompt.trim();
      if (Array.isArray(b.messages)) {
        for (const m of [...b.messages].reverse()) {
          const role = m.role || m.author?.role;
          if (role === 'human' || role === 'user') {
            const c = m.content;
            if (typeof c === 'string') return c.trim();
            if (Array.isArray(c)) {
              const txt = c.find(x => x.type === 'text')?.text;
              if (txt) return txt.trim();
            }
          }
        }
      }
    } catch (_) {}
    return null;
  }

  // ── Generic ─────────────────────────────────────────────────────────────
  function extractGenericQuery(bodyStr) {
    try {
      const b = JSON.parse(bodyStr);
      const candidates = [b.query, b.query_str, b.prompt, b.input, b.text, b.message];
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim().length > 2 && c.length < 500) return c.trim();
      }
      return deepFind(b, 0);
    } catch (_) {}
    return null;
  }

  function deepFind(obj, depth) {
    if (depth > 4 || !obj || typeof obj !== 'object') return null;
    const keys = ['query', 'query_str', 'prompt', 'input', 'text'];
    for (const k of Object.keys(obj)) {
      if (keys.includes(k) && typeof obj[k] === 'string' && obj[k].trim().length > 2 && obj[k].length < 500) {
        return obj[k].trim();
      }
      const found = deepFind(obj[k], depth + 1);
      if (found) return found;
    }
    return null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function emitQuery(query, source, webSearch) {
    _log('Emitting:', source, webSearch ? '(web)' : '', query);
    window.postMessage({ __aeoType: 'QUERY', query, source, webSearch }, '*');
  }

  function getSource() {
    const h = location.hostname;
    if (h.includes('chatgpt.com') || h.includes('openai.com')) return 'ChatGPT';
    if (h.includes('claude.ai')) return 'Claude';
    if (h.includes('perplexity.ai')) return 'Perplexity';
    if (h.includes('gemini.google.com')) return 'Google Gemini';
    if (h.includes('copilot.microsoft.com') || h.includes('bing.com')) return 'Microsoft Copilot';
    return null;
  }

  _log('Injected on', location.hostname);
})();
