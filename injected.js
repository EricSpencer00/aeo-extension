// Runs in PAGE context. No chrome.* API — communicates via window.postMessage only.
(function () {
  if (window.__aeoInjected) return;
  window.__aeoInjected = true;

  const _origFetch = window.fetch;

  window.fetch = async function (...args) {
    try {
      const urlArg = args[0];
      const url = typeof urlArg === 'string' ? urlArg
        : urlArg instanceof Request ? urlArg.url
        : urlArg?.url || '';
      const opts = args[1] || {};
      const body = opts.body;

      // ── ChatGPT: intercept conversation POST ──────────────────────────────
      if (url.includes('/backend-api') && url.includes('conversation')) {
        const res = await _origFetch.apply(this, args);
        tapChatGPTStream(res.clone());
        return res;
      }

      // ── Claude.ai: tap SSE stream for web_search tool calls ───────────────
      if (getSource() === 'Claude' && url.includes('/completion')) {
        const res = await _origFetch.apply(this, args);
        tapClaudeStream(res.clone(), body);
        return res;
      }

      // ── Perplexity: capture query_str from request body ───────────────────
      if (body && typeof body === 'string' && getSource() === 'Perplexity') {
        const q = extractPerplexityQuery(body);
        if (q) emitQuery(q, 'Perplexity', false);
      }

      // ── Gemini / Copilot: generic fallback ───────────────────────────────
      if (body && typeof body === 'string') {
        const src = getSource();
        if (src === 'Google Gemini' || src === 'Microsoft Copilot') {
          const q = extractGenericQuery(body);
          if (q) emitQuery(q, src, false);
        }
      }
    } catch (_) {}

    return _origFetch.apply(this, args);
  };

  // ── ChatGPT SSE tap ────────────────────────────────────────────────────────
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
            if (d.conversation_id && !conversationId) {
              conversationId = d.conversation_id;
            }
            if (d.type === 'input_message') {
              const parts = d.input_message?.content?.parts;
              if (Array.isArray(parts) && typeof parts[0] === 'string') {
                userQuery = parts[0].trim();
              }
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    if (conversationId) {
      await fetchChatGPTSearchQueries(conversationId, userQuery);
    }
  }

  async function fetchChatGPTSearchQueries(conversationId, userQuery) {
    try {
      const sessRes = await _origFetch('/api/auth/session');
      const sess = await sessRes.json();
      const token = sess?.accessToken;
      if (!token) return;

      const convRes = await _origFetch(`/backend-api/conversation/${conversationId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const conv = await convRes.json();
      if (!conv?.mapping) return;

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

      if (searchQueries.length > 0) {
        searchQueries.forEach(q => emitQuery(q, 'ChatGPT', true));
      } else if (userQuery) {
        emitQuery(userQuery, 'ChatGPT', false);
      }
    } catch (_) {}
  }

  // ── Claude.ai SSE tap — extracts web_search tool queries ──────────────────
  async function tapClaudeStream(clonedRes, requestBody) {
    const webSearchQueries = [];
    let userQuery = null;
    let pendingToolName = null;
    let pendingJsonBuf = '';

    // Try to grab user message from the request body as fallback
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

            // Detect tool_use block start → remember name
            if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') {
              pendingToolName = d.content_block.name || null;
              pendingJsonBuf = '';
            }

            // Accumulate tool input JSON
            if (d.type === 'content_block_delta' && d.delta?.type === 'input_json_delta') {
              pendingJsonBuf += d.delta.partial_json || '';
            }

            // Tool block closed — parse accumulated JSON
            if (d.type === 'content_block_stop' && pendingToolName) {
              if (pendingToolName === 'web_search' && pendingJsonBuf) {
                try {
                  const input = JSON.parse(pendingJsonBuf);
                  const q = input.query || input.q || input.search_query;
                  if (typeof q === 'string' && q.trim().length > 1) {
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
    } catch (_) {}

    if (webSearchQueries.length > 0) {
      webSearchQueries.forEach(q => emitQuery(q, 'Claude', true));
    } else if (userQuery) {
      emitQuery(userQuery, 'Claude', false);
    }
  }

  // ── Perplexity query extraction ────────────────────────────────────────────
  function extractPerplexityQuery(bodyStr) {
    try {
      const b = JSON.parse(bodyStr);
      if (b.query_str && typeof b.query_str === 'string') return b.query_str.trim();
    } catch (_) {}
    return null;
  }

  // ── Claude.ai user query extraction (fallback) ─────────────────────────────
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

  // ── Generic query extraction ───────────────────────────────────────────────
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

  // ── Helpers ────────────────────────────────────────────────────────────────
  function emitQuery(query, source, webSearch) {
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
})();
