// Runs in the PAGE context, so it can see the site's own fetch/XHR traffic.
// No chrome.* APIs are available here; everything leaves via window.postMessage
// and is picked up by content.js.
//
// Interception rule: never change what the page receives. Response bodies are
// tapped with a pass-through stream (we are the only reader of the original and
// re-emit every chunk untouched). res.clone() is deliberately NOT used — when a
// site aborts a streaming response, the clone's buffer is torn down and the
// capture is lost. Perplexity does exactly that.
(function () {
  'use strict';
  if (window.__aeoInjected) return;
  window.__aeoInjected = true;

  const P = () => globalThis.AEOParsers;
  let debug = false;
  const log = (...a) => { if (debug) console.log('[AEO]', ...a); };

  // content.js relays the user's debug preference across the world boundary.
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.__aeoType === 'AEO_CONFIG') debug = !!e.data.debug;
  });

  let turnSeq = 0;
  const newTurnId = () =>
    Date.now().toString(36) + '-' + (turnSeq++).toString(36) + '-' +
    Math.random().toString(36).slice(2, 8);

  // ── Source ────────────────────────────────────────────────────────────────
  // __AEO_FORCE_SOURCE__ is honoured only on localhost so the end-to-end test
  // suite can drive the real shipping code against a replay server. It cannot
  // be used to spoof a source on a live AI site.
  function getSource() {
    const h = location.hostname;
    if ((h === 'localhost' || h === '127.0.0.1') && typeof window.__AEO_FORCE_SOURCE__ === 'string') {
      return window.__AEO_FORCE_SOURCE__;
    }
    return P() ? P().detectSource(h) : null;
  }

  // ── Emit ──────────────────────────────────────────────────────────────────
  function post(payload) {
    try { window.postMessage(Object.assign({ __aeoType: 'AEO' }, payload), location.origin || '*'); }
    catch (_) { window.postMessage(Object.assign({ __aeoType: 'AEO' }, payload), '*'); }
  }

  function emitTurn(turnId, source, prompt, url) {
    log('turn', source, prompt);
    post({ kind: 'turn', turnId, source, prompt: prompt || null, url });
  }

  function emitQuery(turnId, source, query) {
    log('query', source, query);
    post({ kind: 'query', turnId, source, query });
  }

  // Structure-only report (key names, never values) so a protocol change on a
  // site is visible and fixable instead of silently capturing nothing.
  function emitDiagnostic(turnId, source, url, info) {
    post({ kind: 'diagnostic', turnId, source, url, info });
  }

  // ── Structural fingerprint ────────────────────────────────────────────────
  function keyFingerprint(text) {
    const keys = new Map();
    const re = /"([A-Za-z_][A-Za-z0-9_]{0,40})"\s*:/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      keys.set(m[1], (keys.get(m[1]) || 0) + 1);
    }
    const interesting = [...keys.entries()]
      .filter(([k]) => /quer|search|tool|recipient|name|type|event|block/i.test(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([k, n]) => k + ':' + n);
    const events = [...new Set(
      (text.match(/^event:\s*(.+)$/gm) || []).map((s) => s.replace(/^event:\s*/, '').trim())
    )].slice(0, 20);
    return { keys: interesting, events, bytes: text.length };
  }

  // ── Pass-through response tap ─────────────────────────────────────────────
  function tapResponse(res, ctx) {
    if (!res || !res.body) return res;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const extractor = P().createStreamExtractor(ctx.source, (q) => {
      ctx.found++;
      emitQuery(ctx.turnId, ctx.source, q);
    });
    let sample = '';
    const SAMPLE_MAX = 300000;

    const stream = new ReadableStream({
      async pull(controller) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (e) {
          controller.error(e);
          finish();
          return;
        }
        if (chunk.done) {
          controller.close();
          finish();
          return;
        }
        controller.enqueue(chunk.value);
        try {
          const text = decoder.decode(chunk.value, { stream: true });
          if (sample.length < SAMPLE_MAX) sample += text;
          extractor.push(text);
        } catch (e) { log('parse error', e); }
      },
      cancel(reason) {
        try { reader.cancel(reason); } catch (_) {}
        finish();
      },
    });

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      try { extractor.finish(sample); } catch (e) { log('finish error', e); }
      log('stream done', ctx.source, 'queries=', ctx.found);
      // A short body is an ack, not a protocol we failed to read; recording it
      // would bury a genuine protocol change in noise.
      if (ctx.found === 0 && sample.length > 500) {
        emitDiagnostic(ctx.turnId, ctx.source, ctx.url, keyFingerprint(sample));
      }
      if (ctx.found === 0 && ctx.source === 'ChatGPT') chatGPTFallback(ctx);
    }

    const out = new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
    try {
      Object.defineProperty(out, 'url', { value: res.url, configurable: true });
      Object.defineProperty(out, 'redirected', { value: res.redirected, configurable: true });
    } catch (_) {}
    return out;
  }

  // ── ChatGPT fallback ──────────────────────────────────────────────────────
  // When the live stream does not carry the queries, the persisted conversation
  // does: tool messages keep metadata.search_model_queries. Only reachable when
  // signed in; logged-out ChatGPT never exposes query strings at all.
  async function chatGPTFallback(ctx) {
    try {
      const convId = (location.pathname.match(/\/(?:c|uc)\/([0-9a-f-]{16,})/i) || [])[1];
      if (!convId) return;
      await new Promise((r) => setTimeout(r, 800));
      const sess = await origFetch('/api/auth/session').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const token = sess && sess.accessToken;
      if (!token) { log('fallback: no session token (logged out)'); return; }
      const conv = await origFetch('/backend-api/conversation/' + convId, {
        headers: { Authorization: 'Bearer ' + token },
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!conv) return;
      const found = P().collectSearchQueries(conv, [], 0);
      log('fallback found', found.length);
      found.forEach((q) => emitQuery(ctx.turnId, 'ChatGPT', q));
    } catch (e) { log('fallback error', e); }
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    let ctx = null;
    try {
      const src = getSource();
      if (src && P()) {
        const a0 = args[0];
        const init = args[1] || {};
        const url = typeof a0 === 'string' ? a0
          : a0 instanceof Request ? a0.url
          : (typeof URL !== 'undefined' && a0 instanceof URL) ? a0.href
          : (a0 && a0.url) || String(a0 == null ? '' : a0);
        const method = String(
          init.method || (a0 instanceof Request ? a0.method : 'GET') || 'GET'
        ).toUpperCase();

        if (P().isInterestingRequest(src, url, method)) {
          let bodyText = null;
          if (typeof init.body === 'string') bodyText = init.body;
          else if (init.body instanceof URLSearchParams) bodyText = init.body.toString();
          else if (a0 instanceof Request) {
            try { bodyText = await a0.clone().text(); } catch (_) {}
          }
          const turnId = newTurnId();
          const prompt = P().extractUserPrompt(src, bodyText);
          // A turn with neither a prompt nor (yet) a query is noise. If queries
          // turn up later the service worker creates the turn for them.
          if (prompt) emitTurn(turnId, src, prompt, url);
          ctx = { turnId, source: src, url, found: 0 };
        }
      }
    } catch (e) { log('pre-flight error', e); }

    const res = await origFetch.apply(this, args);
    if (!ctx) return res;
    try { return tapResponse(res, ctx); } catch (e) { log('tap error', e); return res; }
  };

  // ── XMLHttpRequest ────────────────────────────────────────────────────────
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__aeo = { method: String(method).toUpperCase(), url: String(url) }; } catch (_) {}
    return XO.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      const src = getSource();
      const meta = this.__aeo;
      if (src && P() && meta && P().isInterestingRequest(src, meta.url, meta.method)) {
        const turnId = newTurnId();
        const bodyText = typeof body === 'string' ? body : null;
        emitTurn(turnId, src, P().extractUserPrompt(src, bodyText), meta.url);
        const ctx = { turnId, source: src, url: meta.url, found: 0 };
        const xhr = this;
        let lastLen = 0;
        const extractor = P().createStreamExtractor(src, (q) => {
          ctx.found++;
          emitQuery(turnId, src, q);
        });
        let sample = '';
        const drain = () => {
          try {
            if (xhr.responseType !== '' && xhr.responseType !== 'text') return;
            const t = xhr.responseText || '';
            if (t.length > lastLen) {
              const chunk = t.slice(lastLen);
              lastLen = t.length;
              if (sample.length < 300000) sample += chunk;
              extractor.push(chunk);
            }
          } catch (_) {}
        };
        this.addEventListener('progress', drain);
        this.addEventListener('loadend', () => {
          drain();
          try { extractor.finish(sample); } catch (_) {}
          if (ctx.found === 0) emitDiagnostic(turnId, src, meta.url, keyFingerprint(sample));
        });
      }
    } catch (e) { log('xhr error', e); }
    return XS.call(this, body);
  };

  // ── EventSource ───────────────────────────────────────────────────────────
  const OrigES = window.EventSource;
  if (OrigES) {
    const Patched = function (url, cfg) {
      const es = cfg === undefined ? new OrigES(url) : new OrigES(url, cfg);
      try {
        const src = getSource();
        if (src && P()) {
          const turnId = newTurnId();
          let announced = false;
          const extractor = P().createStreamExtractor(src, (q) => {
            if (!announced) { emitTurn(turnId, src, null, String(url)); announced = true; }
            emitQuery(turnId, src, q);
          });
          es.addEventListener('message', (ev) => {
            try { extractor.push('data: ' + ev.data + '\n\n'); } catch (_) {}
          });
        }
      } catch (_) {}
      return es;
    };
    Patched.prototype = OrigES.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSED']) Patched[k] = OrigES[k];
    window.EventSource = Patched;
  }

  // parsers.js is declared ahead of this file in the same MAIN-world entry,
  // so it should always be here. If it is not, every tap above silently
  // no-ops and the panel looks exactly as if the site had stopped searching.
  // Say so instead: once in the console, once in the Status tab.
  if (!P()) {
    console.warn('[AEO Queries] parsers.js did not load, so nothing will be captured on ' +
      location.hostname + '. If the extension files were updated, open the extensions page and click Reload.');
    emitDiagnostic(null, location.hostname, location.href, { error: 'parsers-missing' });
  }

  log('injected on', location.hostname, 'source=', getSource());
  post({ kind: 'ready', source: getSource() });
})();
