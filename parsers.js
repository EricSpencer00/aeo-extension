// AEO query parsers — pure functions, no DOM and no chrome.* access.
// Loaded verbatim by injected.js in the page context and by the Node test
// suite, so the exact code that ships is the code that is tested.
//
// The job: given what an AI site streams back, recover the EXACT search
// queries the model issued against the web, plus the human prompt that
// caused them.
(function (root) {
  'use strict';

  const MAX_QUERY_LEN = 400;
  const MIN_QUERY_LEN = 2;

  // ── Source detection ──────────────────────────────────────────────────────
  function detectSource(hostname) {
    const h = String(hostname || '');
    if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'ChatGPT';
    if (h.includes('claude.ai')) return 'Claude';
    if (h.includes('perplexity.ai')) return 'Perplexity';
    if (h.includes('gemini.google.com')) return 'Google Gemini';
    if (h.includes('copilot.microsoft.com')) return 'Microsoft Copilot';
    return null;
  }

  // ── Validation ────────────────────────────────────────────────────────────
  // Search queries are short natural-language strings. Reject anything that
  // looks like an id, a blob of markup, a URL, or serialized data.
  const NOISE = new Set(['undefined', 'null', 'true', 'false', 'none', 'nan', '{}', '[]', '']);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HEXBLOB_RE = /^[0-9a-f]{24,}$/i;
  const B64ISH_RE = /^[A-Za-z0-9+/=_-]{40,}$/;

  function isPlausibleQuery(s) {
    if (typeof s !== 'string') return false;
    const q = s.trim();
    if (q.length < MIN_QUERY_LEN || q.length > MAX_QUERY_LEN) return false;
    if (NOISE.has(q.toLowerCase())) return false;
    if (UUID_RE.test(q) || HEXBLOB_RE.test(q)) return false;
    if (/^[{[<]/.test(q)) return false;
    if (/^https?:\/\//i.test(q)) return false;
    if (/^data:/i.test(q)) return false;
    if (q.includes('\n')) return false;
    // Needs at least one letter — pure punctuation/number strings are ids.
    if (!/[a-z]/i.test(q)) return false;
    // Long unbroken token with no spaces is almost certainly an identifier.
    if (!q.includes(' ') && q.length > 60) return false;
    if (B64ISH_RE.test(q) && !q.includes(' ')) return false;
    return true;
  }

  function normalizeQuery(s) {
    return String(s).trim().replace(/\s+/g, ' ');
  }

  // ── Shape-driven search-query collector ───────────────────────────────────
  // Rather than hard-coding one JSON path per site, we recognise the *shapes*
  // that carry an issued search query. New site revisions tend to keep the
  // shape and move it, so this survives redesigns that a fixed path would not.
  // Tool identifiers that mean "this call went to a web search engine".
  // Covers Anthropic's web_search, OpenAI's web / web.run / browser, and
  // Perplexity's search_web.
  const SEARCH_TOOL_RE =
    /^(web_)?search(_web|_query|_with_bing|_engine)?$|^browser(\.search)?$|^web(\.run|\.search|_run)?$|^bing$/i;

  function looksLikeSearchTool(name) {
    return typeof name === 'string' && SEARCH_TOOL_RE.test(name.trim());
  }

  function collectSearchQueries(node, out, depth) {
    if (node == null || depth > 12) return out;

    if (Array.isArray(node)) {
      for (const v of node) collectSearchQueries(v, out, depth + 1);
      return out;
    }
    if (typeof node !== 'object') return out;

    // Perplexity: { queries_payload: { queries: [...] } }
    const qp = node.queries_payload;
    if (qp && Array.isArray(qp.queries)) pushAll(qp.queries, out);

    // ChatGPT: { metadata: { search_model_queries: { queries: [...] } } }
    const smq = node.search_model_queries;
    if (smq && Array.isArray(smq.queries)) pushAll(smq.queries, out);

    // Generic arrays of issued queries used by several surfaces.
    for (const key of ['search_queries', 'issued_queries', 'queries']) {
      const v = node[key];
      // Bare `queries` is only trusted when the object also identifies itself
      // as a search step, otherwise it collides with "related questions".
      if (key === 'queries' && !isSearchContext(node)) continue;
      if (Array.isArray(v)) pushAll(v, out);
    }

    // ChatGPT result groups: { search_result_groups: [{ search_query: "..." }] }
    // and web.run arguments: { search_query: [{ q: "..." }, ...] }
    if (typeof node.search_query === 'string') pushOne(node.search_query, out);
    else if (Array.isArray(node.search_query)) pushAll(node.search_query, out);
    if (Array.isArray(node.search_result_groups)) {
      for (const g of node.search_result_groups) {
        if (g && typeof g.search_query === 'string') pushOne(g.search_query, out);
      }
    }

    // ChatGPT streams later frames as JSON-pointer patches rather than whole
    // objects: {"p": "/message/metadata/search_model_queries/queries/0",
    //           "o": "add", "v": "best noise cancelling headphones"}.
    // The recursive walk below already finds patches whose value is a whole
    // object; this catches the ones that carry a bare string at a query path.
    if (typeof node.p === 'string' && /quer|search/i.test(node.p)) {
      if (typeof node.v === 'string') pushOne(node.v, out);
      else if (Array.isArray(node.v)) pushAll(node.v, out);
    }

    // Claude / Anthropic tool_use and server_tool_use blocks.
    if ((node.type === 'tool_use' || node.type === 'server_tool_use' || node.type === 'mcp_tool_use') &&
        looksLikeSearchTool(node.name)) {
      pushFromToolInput(node.input, out);
    }
    // content_block wrapper form.
    if (node.content_block) collectSearchQueries(node.content_block, out, depth + 1);

    // Tool invocation shapes that carry the arguments separately.
    if (looksLikeSearchTool(node.name) || looksLikeSearchTool(node.tool_name) ||
        looksLikeSearchTool(node.recipient) || looksLikeSearchTool(node.function_name)) {
      pushFromToolInput(node.input, out);
      pushFromToolInput(node.args, out);
      pushFromToolInput(node.arguments, out);
      pushFromToolInput(node.parameters, out);
      pushFromToolInput(node.tool_input, out);
      // ChatGPT addresses its browsing tool with `recipient` and carries the
      // arguments as a JSON string in content.text.
      if (node.content && typeof node.content.text === 'string') {
        pushFromToolInput(node.content.text, out);
      } else if (typeof node.content === 'string') {
        pushFromToolInput(node.content, out);
      }
    }

    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') collectSearchQueries(v, out, depth + 1);
    }
    return out;
  }

  function isSearchContext(node) {
    return looksLikeSearchTool(node.tool_name) || looksLikeSearchTool(node.name) ||
      node.icon === 'search' || node.type === 'search' ||
      typeof node.search_focus === 'string';
  }

  // A tool's arguments may be an object or a JSON string.
  function pushFromToolInput(input, out) {
    if (input == null) return;
    let obj = input;
    if (typeof input === 'string') {
      const t = input.trim();
      if (!t) return;
      if (t.startsWith('{') || t.startsWith('[')) {
        try { obj = JSON.parse(t); } catch { return; }
      } else {
        // Older ChatGPT browsing calls are literal code: search("query").
        const call = t.match(/^\s*(?:search|open_url|find)\s*\(\s*(['"])([\s\S]*?)\1/);
        if (call) { pushOne(call[2], out); return; }
        // Otherwise a bare string argument is the query itself.
        pushOne(t, out);
        return;
      }
    }
    if (Array.isArray(obj)) {
      for (const v of obj) pushFromToolInput(v, out);
      return;
    }
    if (typeof obj !== 'object') return;
    for (const key of ['query', 'q', 'search_query', 'searchQuery', 'text', 'prompt', 'keyword', 'keywords']) {
      const v = obj[key];
      if (typeof v === 'string') pushOne(v, out);
      else if (Array.isArray(v)) pushAll(v, out);
    }
    for (const key of ['queries', 'search_queries', 'search_query']) {
      if (Array.isArray(obj[key])) pushAll(obj[key], out);
    }
  }

  function pushOne(s, out) {
    if (!isPlausibleQuery(s)) return;
    const q = normalizeQuery(s);
    if (!out.includes(q)) out.push(q);
  }

  function pushAll(arr, out) {
    for (const v of arr) {
      if (typeof v === 'string') pushOne(v, out);
      // Perplexity related_query_items: [{ text: "..." }]
      else if (v && typeof v === 'object' && typeof v.text === 'string') pushOne(v.text, out);
      else if (v && typeof v === 'object' && typeof v.q === 'string') pushOne(v.q, out);
      else if (v && typeof v === 'object' && typeof v.query === 'string') pushOne(v.query, out);
    }
  }

  // ── SSE framing ───────────────────────────────────────────────────────────
  // Incremental Server-Sent-Events splitter. Feed it raw chunks, get back
  // complete { event, data } frames. Handles \n and \r\n and multi-line data.
  function createSSEParser() {
    let buf = '';
    return {
      push(chunk) {
        buf += chunk;
        const frames = [];
        let idx;
        // Frames are separated by a blank line.
        while ((idx = findFrameEnd(buf)) !== -1) {
          const raw = buf.slice(0, idx.end);
          buf = buf.slice(idx.next);
          const frame = parseFrame(raw);
          if (frame) frames.push(frame);
        }
        // Guard against a server that never sends blank lines: if the buffer
        // grows huge, flush whole lines as frames.
        if (buf.length > 1_000_000) {
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const f = parseFrame(line);
            if (f) frames.push(f);
          }
        }
        return frames;
      },
      flush() {
        const rest = buf;
        buf = '';
        const f = parseFrame(rest);
        return f ? [f] : [];
      },
    };
  }

  function findFrameEnd(s) {
    const a = s.indexOf('\n\n');
    const b = s.indexOf('\r\n\r\n');
    if (a === -1 && b === -1) return -1;
    if (b !== -1 && (a === -1 || b < a)) return { end: b, next: b + 4 };
    return { end: a, next: a + 2 };
  }

  function parseFrame(raw) {
    if (!raw || !raw.trim()) return null;
    let event = null;
    const dataLines = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (!dataLines.length) return null;
    const data = dataLines.join('\n');
    if (data === '[DONE]') return { event, data, json: null, done: true };
    let json = null;
    if (data.startsWith('{') || data.startsWith('[')) {
      try { json = JSON.parse(data); } catch { json = null; }
    }
    return { event, data, json };
  }

  // ── Streaming extractor ───────────────────────────────────────────────────
  // One object per intercepted response. Feed it decoded chunks; it emits
  // deduplicated queries as soon as they appear in the stream.
  function createStreamExtractor(source, onQuery) {
    const sse = createSSEParser();
    const seen = new Set();
    // Anthropic streams tool arguments as incremental JSON fragments, so we
    // reassemble per content-block index before parsing.
    const toolBlocks = new Map();
    let sawSSE = false;
    let raw = '';

    function emit(q) {
      const n = normalizeQuery(q);
      if (!isPlausibleQuery(n) || seen.has(n)) return;
      seen.add(n);
      onQuery(n);
    }

    function handleJson(obj) {
      if (!obj || typeof obj !== 'object') return;

      // Anthropic incremental tool input assembly.
      if (obj.type === 'content_block_start' && obj.content_block) {
        const cb = obj.content_block;
        if (cb.type === 'tool_use' || cb.type === 'server_tool_use' || cb.type === 'mcp_tool_use') {
          toolBlocks.set(obj.index, { name: cb.name, json: '' });
          // Some replays deliver the whole input up front.
          if (cb.input && Object.keys(cb.input).length && looksLikeSearchTool(cb.name)) {
            const out = [];
            pushFromToolInput(cb.input, out);
            out.forEach(emit);
          }
        }
      }
      if (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'input_json_delta') {
        const blk = toolBlocks.get(obj.index);
        if (blk) blk.json += obj.delta.partial_json || '';
      }
      if (obj.type === 'content_block_stop') {
        const blk = toolBlocks.get(obj.index);
        if (blk) {
          if (looksLikeSearchTool(blk.name) && blk.json) {
            const out = [];
            pushFromToolInput(blk.json, out);
            out.forEach(emit);
          }
          toolBlocks.delete(obj.index);
        }
      }

      const found = collectSearchQueries(obj, [], 0);
      found.forEach(emit);
    }

    return {
      push(chunk) {
        raw += chunk.length > 200000 ? '' : chunk;
        const frames = sse.push(chunk);
        if (frames.length) sawSSE = true;
        for (const f of frames) {
          if (f.json) handleJson(f.json);
        }
      },
      // Some endpoints answer with a single JSON document rather than SSE.
      finish(fullText) {
        for (const f of sse.flush()) if (f.json) handleJson(f.json);
        if (!sawSSE) {
          const text = fullText != null ? fullText : raw;
          const t = String(text).trim();
          if (t.startsWith('{') || t.startsWith('[')) {
            try { handleJson(JSON.parse(t)); } catch {}
          } else {
            // NDJSON fallback.
            for (const line of t.split('\n')) {
              const l = line.trim();
              if (!l.startsWith('{')) continue;
              try { handleJson(JSON.parse(l)); } catch {}
            }
          }
        }
      },
      get count() { return seen.size; },
      get queries() { return [...seen]; },
    };
  }

  // ── Request-body extractors: the human's prompt ───────────────────────────
  function extractUserPrompt(source, bodyText) {
    if (!bodyText || typeof bodyText !== 'string') return null;
    let b;
    try { b = JSON.parse(bodyText); } catch { return null; }
    if (!b || typeof b !== 'object') return null;

    // Perplexity puts it at the top level.
    if (typeof b.query_str === 'string' && b.query_str.trim()) return clampPrompt(b.query_str);
    if (b.params && typeof b.params.dsl_query === 'string' && b.params.dsl_query.trim()) {
      return clampPrompt(b.params.dsl_query);
    }

    // claude.ai legacy completion shape.
    if (typeof b.prompt === 'string' && b.prompt.trim()) return clampPrompt(b.prompt);

    // Message-array shapes (ChatGPT, claude.ai, Gemini).
    const msgs = Array.isArray(b.messages) ? b.messages
      : Array.isArray(b.contents) ? b.contents : null;
    if (msgs) {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m) continue;
        const role = m.role || (m.author && m.author.role);
        if (role && role !== 'user' && role !== 'human') continue;
        const text = textFromMessageContent(m.content != null ? m.content : m.parts);
        if (text) return clampPrompt(text);
      }
    }
    for (const key of ['input', 'text', 'message', 'q', 'query']) {
      if (typeof b[key] === 'string' && b[key].trim()) return clampPrompt(b[key]);
    }
    return null;
  }

  function textFromMessageContent(content) {
    if (content == null) return null;
    if (typeof content === 'string') return content.trim() || null;
    if (Array.isArray(content)) {
      const parts = [];
      for (const p of content) {
        if (typeof p === 'string') parts.push(p);
        else if (p && typeof p === 'object') {
          if (typeof p.text === 'string') parts.push(p.text);
          else if (p.type === 'text' && typeof p.content === 'string') parts.push(p.content);
        }
      }
      const joined = parts.join('\n').trim();
      return joined || null;
    }
    if (typeof content === 'object') {
      if (Array.isArray(content.parts)) return textFromMessageContent(content.parts);
      if (typeof content.text === 'string') return content.text.trim() || null;
    }
    return null;
  }

  function clampPrompt(s) {
    const t = String(s).trim().replace(/\s+/g, ' ');
    if (!t) return null;
    return t.length > 500 ? t.slice(0, 500) + '…' : t;
  }

  // ── Endpoint matching ─────────────────────────────────────────────────────
  // Which requests are worth tapping, per site. Kept broad on purpose: an
  // endpoint rename should not silently switch capture off.
  function isInterestingRequest(source, url, method) {
    const u = String(url || '');
    const m = String(method || 'GET').toUpperCase();
    if (m !== 'POST' && m !== 'PUT') return false;
    switch (source) {
      case 'Perplexity':
        // Only the answer stream. /rest/thread/* and friends carry no queries
        // and would otherwise register empty turns.
        return /\/rest\/sse\/|perplexity_ask/i.test(u);
      case 'ChatGPT':
        // The answer stream only. /conversation/init, /prepare and /runtime are
        // setup calls that carry no queries and would register empty turns.
        if (/\/conversation\/(init|prepare|runtime|voice|textdocs)/i.test(u)) return false;
        return /\/(backend-api|backend-anon|unauth-mweb|api)\/(f\/)?conversation(\?|$)/i.test(u) ||
          /\/conversation\/updates(\?|$)/i.test(u);
      case 'Claude':
        return /\/completion|\/chat_conversations\/.*\/(completion|retry)|\/messages/i.test(u);
      case 'Google Gemini':
        return /StreamGenerate|BardFrontendService|assistant\.lamda/i.test(u);
      case 'Microsoft Copilot':
        return /\/c\/api\/|conversations|turing|chathub/i.test(u);
      default:
        return false;
    }
  }

  const AEO = {
    detectSource,
    isPlausibleQuery,
    normalizeQuery,
    collectSearchQueries,
    createSSEParser,
    createStreamExtractor,
    extractUserPrompt,
    isInterestingRequest,
    looksLikeSearchTool,
    MAX_QUERY_LEN,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AEO;
  root.AEOParsers = AEO;
})(typeof globalThis !== 'undefined' ? globalThis : this);
