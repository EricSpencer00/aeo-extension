// Page-context traffic recorder, injected via CDP Page.addScriptToEvaluateOnNewDocument.
// Records every fetch / XHR / EventSource / WebSocket exchange with FULL bodies so we can
// see exactly what each AI site sends and streams back. Purely a development tool; it is
// never shipped in the extension.
(function () {
  if (window.__aeoRec) return;
  const MAX = 4_000_000;
  const rec = { entries: [], log: [] };
  window.__aeoRec = rec;

  const push = (e) => {
    e.t = Date.now();
    rec.entries.push(e);
    if (rec.entries.length > 400) rec.entries.shift();
  };

  const asText = (body) => {
    try {
      if (body == null) return null;
      if (typeof body === 'string') return body.slice(0, MAX);
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) {
        const o = {};
        for (const [k, v] of body.entries()) o[k] = typeof v === 'string' ? v : '<blob>';
        return JSON.stringify(o);
      }
      if (body instanceof ArrayBuffer) return new TextDecoder().decode(body).slice(0, MAX);
      if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body).slice(0, MAX);
      return String(body).slice(0, MAX);
    } catch (e) { return '<unreadable:' + e.message + '>'; }
  };

  // ── fetch ────────────────────────────────────────────────────────────────
  // Note: res.clone() is NOT usable here. When the page aborts a streaming
  // response (Perplexity does), the clone's buffer is torn down and we lose
  // everything. Instead we become the sole reader of the original body and
  // hand the page a pass-through stream.
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const a0 = args[0];
    const url = typeof a0 === 'string' ? a0
      : a0 instanceof Request ? a0.url
      : typeof URL !== 'undefined' && a0 instanceof URL ? a0.href
      : (a0?.url || String(a0 ?? ''));
    const opts = args[1] || {};
    const method = (opts.method || (a0 instanceof Request ? a0.method : 'GET') || 'GET').toUpperCase();
    let reqBody = asText(opts.body);
    if (reqBody == null && a0 instanceof Request) {
      try { reqBody = asText(await a0.clone().text()); } catch {}
    }
    const entry = { kind: 'fetch', url, method, reqBody, resBody: '', status: null, ct: null };
    push(entry);
    const res = await origFetch.apply(this, args);
    entry.status = res.status;
    entry.ct = res.headers.get('content-type');
    if (!res.body) return res;

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    const stream = new ReadableStream({
      async pull(ctrl) {
        try {
          const { done, value } = await reader.read();
          if (done) { entry.done = true; ctrl.close(); return; }
          if (entry.resBody.length < MAX) entry.resBody += dec.decode(value, { stream: true });
          ctrl.enqueue(value);
        } catch (e) {
          entry.err = String(e && e.message);
          ctrl.error(e);
        }
      },
      cancel(reason) { entry.cancelled = true; try { reader.cancel(reason); } catch {} },
    });
    const out = new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
    try { Object.defineProperty(out, 'url', { value: res.url }); } catch {}
    return out;
  };

  // ── XHR ──────────────────────────────────────────────────────────────────
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__aeo = { kind: 'xhr', method: String(method).toUpperCase(), url: String(url) };
    return XO.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const entry = { ...(this.__aeo || { kind: 'xhr' }), reqBody: asText(body), resBody: null, status: null };
    push(entry);
    this.addEventListener('loadend', () => {
      entry.status = this.status;
      try { entry.ct = this.getResponseHeader('content-type'); } catch {}
      try {
        entry.resBody = (this.responseType === '' || this.responseType === 'text')
          ? String(this.responseText).slice(0, MAX)
          : '<' + this.responseType + '>';
      } catch (e) { entry.resBody = '<err:' + e.message + '>'; }
      entry.done = true;
    });
    return XS.call(this, body);
  };

  // ── EventSource ──────────────────────────────────────────────────────────
  const OrigES = window.EventSource;
  if (OrigES) {
    window.EventSource = function (url, cfg) {
      const es = new OrigES(url, cfg);
      const entry = { kind: 'eventsource', url: String(url), method: 'GET', reqBody: null, resBody: '' };
      push(entry);
      es.addEventListener('message', (ev) => {
        if (entry.resBody.length < MAX) entry.resBody += 'data: ' + ev.data + '\n\n';
      });
      const origAdd = es.addEventListener.bind(es);
      es.addEventListener = function (type, fn, o) {
        if (type !== 'message' && type !== 'open' && type !== 'error') {
          origAdd(type, (ev) => {
            if (entry.resBody.length < MAX) entry.resBody += 'event: ' + type + '\ndata: ' + ev.data + '\n\n';
          });
        }
        return origAdd(type, fn, o);
      };
      return es;
    };
    window.EventSource.prototype = OrigES.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSED']) window.EventSource[k] = OrigES[k];
  }

  // ── WebSocket ────────────────────────────────────────────────────────────
  const OrigWS = window.WebSocket;
  window.WebSocket = function (url, proto) {
    const ws = proto === undefined ? new OrigWS(url) : new OrigWS(url, proto);
    const entry = { kind: 'websocket', url: String(url), method: 'WS', reqBody: '', resBody: '' };
    push(entry);
    const origSend = ws.send.bind(ws);
    ws.send = function (d) {
      if (entry.reqBody.length < MAX) entry.reqBody += asText(d) + '\n---\n';
      return origSend(d);
    };
    ws.addEventListener('message', (ev) => {
      if (entry.resBody.length < MAX) entry.resBody += asText(ev.data) + '\n---\n';
    });
    return ws;
  };
  window.WebSocket.prototype = OrigWS.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) window.WebSocket[k] = OrigWS[k];

  console.log('[AEO-REC] recording on', location.href);
})();
