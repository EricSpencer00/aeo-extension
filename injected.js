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

      // ── ChatGPT: any POST to backend-api ────────────────────────────────
      if (url.includes('chatgpt.com') || url.includes('openai.com') || getSource() === 'ChatGPT') {
        if (method === 'POST' && (
          url.includes('/backend-api') ||
          url.includes('/backend-anon') ||
          url.includes('/api/f/') ||
          url.includes('conversation')
        )) {
          _log('ChatGPT POST intercepted:', url);
          const res = await _origFetch.apply(this, args);

          // Immediate: grab user message from request body
          if (body && typeof body === 'string') {
            const q = extractChatGPTRequestQuery(body);
            if (q) {
              _log('ChatGPT user msg (immediate):', q);
              emitQuery(q, 'ChatGPT', false);
            }
          }

          // Async: tap SSE stream and get real search queries
          tapChatGPTStream(res.clone());
          return res;
        }
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

  // ── Grab user message from ChatGPT POST body ────────────────────────────
  function extractChatGPTRequestQuery(bodyStr) {
    try {
      const b = JSON.parse(bodyStr);
      // New format: messages array
      if (Array.isArray(b.messages)) {
        for (const m of [...b.messages].reverse()) {
          if (m.author?.role === 'user' || m.role === 'user') {
            const parts = m.content?.parts;
            if (Array.isArray(parts) && typeof parts[0] === 'string' && parts[0].trim().length > 1) {
              return parts[0].trim();
            }
            if (typeof m.content === 'string' && m.content.trim().length > 1) {
              return m.content.trim();
            }
          }
        }
      }
      // Older format
      if (typeof b.prompt === 'string' && b.prompt.trim().length > 1) return b.prompt.trim();
    } catch (_) {}
    return null;
  }

  // ── ChatGPT SSE tap ─────────────────────────────────────────────────────
  async function tapChatGPTStream(clonedRes) {
    let conversationId = null;
    let userQuery = null;

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
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const d = JSON.parse(data);
            if (d.conversation_id && !conversationId) conversationId = d.conversation_id;
            if (d.type === 'input_message') {
              const parts = d.input_message?.content?.parts;
              if (Array.isArray(parts) && typeof parts[0] === 'string') {
                userQuery = parts[0].trim();
              }
            }
          } catch (_) {}
        }
      }
    } catch (e) { _log('ChatGPT stream error:', e); }

    _log('ChatGPT stream done. conversationId:', conversationId);
    if (conversationId) await fetchChatGPTSearchQueries(conversationId, userQuery);
  }

  async function fetchChatGPTSearchQueries(conversationId, userQuery) {
    try {
      const sessRes = await _origFetch('/api/auth/session');
      const sess = await sessRes.json();
      const token = sess?.accessToken;
      if (!token) { _log('ChatGPT: no auth token'); return; }

      const convRes = await _origFetch(`/backend-api/conversation/${conversationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const conv = await convRes.json();
      if (!conv?.mapping) { _log('ChatGPT: no mapping in conversation'); return; }

      const nodes = Object.values(conv.mapping);
      const searchQueries = [];

      for (const node of nodes) {
        const msg = node.message;
        if (!msg || msg.author?.role !== 'tool') continue;
        const queries = msg.metadata?.search_model_queries?.queries;
        if (Array.isArray(queries)) {
          searchQueries.push(...queries.filter(q => typeof q === 'string' && q.trim().length > 1));
        }
      }

      _log('ChatGPT search queries found:', searchQueries);
      if (searchQueries.length > 0) {
        searchQueries.forEach(q => emitQuery(q, 'ChatGPT', true));
      } else if (userQuery) {
        emitQuery(userQuery, 'ChatGPT', false);
      }
    } catch (e) { _log('ChatGPT conversation fetch error:', e); }
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
