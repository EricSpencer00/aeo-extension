// Serves captured/fixture AI streams from localhost on the same URL shapes the
// real sites use, so the shipping extension can be exercised end-to-end without
// an account. Started automatically by tools/test-e2e.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, 'fixtures');

const SCENARIOS = {
  Claude: {
    endpoint: '/api/organizations/org-1/chat_conversations/conv-1/completion',
    body: { prompt: 'what should I rank for in AI answers?', timezone: 'America/Chicago' },
    stream: () => fs.readFileSync(path.join(FIX, 'claude-ai-frontend.sse'), 'utf8'),
    contentType: 'text/event-stream',
  },
  ClaudeApi: {
    source: 'Claude',
    endpoint: '/api/organizations/org-1/chat_conversations/conv-2/completion',
    body: { messages: [{ role: 'human', content: [{ type: 'text', text: 'best headphones for flights' }] }] },
    stream: () => fs.readFileSync(path.join(FIX, 'claude-websearch.sse'), 'utf8'),
    contentType: 'text/event-stream',
  },
  ChatGPT: {
    endpoint: '/backend-api/f/conversation',
    body: {
      action: 'next',
      messages: [{ id: 'u1', author: { role: 'user' }, content: { content_type: 'text', parts: ['best noise cancelling headphones for travel 2026'] } }],
    },
    stream: () => fs.readFileSync(path.join(FIX, 'chatgpt-websearch.sse'), 'utf8'),
    contentType: 'text/event-stream',
  },
  Perplexity: {
    endpoint: '/rest/sse/perplexity_ask',
    body: null, // taken verbatim from the live capture
    stream: () => JSON.parse(fs.readFileSync(path.join(FIX, 'perplexity-multistep.json'), 'utf8')).resBody,
    contentType: 'text/event-stream',
  },
  // Same as Perplexity, but the page aborts the response before it finishes.
  // This is what a res.clone() based tap fails on.
  PerplexityAbort: {
    source: 'Perplexity',
    endpoint: '/rest/sse/perplexity_ask',
    body: null,
    abortAfterMs: 1500,
    stream: () => JSON.parse(fs.readFileSync(path.join(FIX, 'perplexity-multistep.json'), 'utf8')).resBody,
    contentType: 'text/event-stream',
  },
};

function scenarioBody(name) {
  const s = SCENARIOS[name];
  if (s.body) return JSON.stringify(s.body);
  const cap = JSON.parse(fs.readFileSync(path.join(FIX, 'perplexity-multistep.json'), 'utf8'));
  return cap.reqBody;
}

function page(name) {
  const s = SCENARIOS[name];
  const source = s.source || name;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>AEO replay — ${name}</title>
<script>window.__AEO_FORCE_SOURCE__ = ${JSON.stringify(source)};</script>
</head>
<body>
<h1>replay: ${name}</h1>
<pre id="out">idle</pre>
<script>
const out = document.getElementById('out');
window.__aeoReplayDone = false;
window.__aeoReplayChars = 0;
(async () => {
  try {
    const ctrl = new AbortController();
    ${s.abortAfterMs ? `setTimeout(() => ctrl.abort(), ${s.abortAfterMs});` : ''}
    const res = await fetch(${JSON.stringify(s.endpoint)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: ${JSON.stringify(scenarioBody(name))},
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      window.__aeoReplayChars += dec.decode(value, { stream: true }).length;
      out.textContent = 'streaming… ' + window.__aeoReplayChars + ' chars';
    }
    out.textContent = 'complete: ' + window.__aeoReplayChars + ' chars';
  } catch (e) {
    out.textContent = 'aborted after ' + window.__aeoReplayChars + ' chars (' + e.name + ')';
    window.__aeoReplayAborted = true;
  }
  window.__aeoReplayDone = true;
})();
</script>
</body></html>`;
}

export function startServer(port = 8899) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      const name = url.searchParams.get('scenario') || 'Perplexity';
      if (!SCENARIOS[name]) { res.writeHead(404); res.end('unknown scenario'); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page(name));
      return;
    }

    if (req.method === 'POST') {
      const name = Object.keys(SCENARIOS).find((k) => SCENARIOS[k].endpoint === url.pathname);
      if (!name) { res.writeHead(404); res.end('no scenario for ' + url.pathname); return; }
      const s = SCENARIOS[name];
      const text = s.stream();
      res.writeHead(200, {
        'content-type': s.contentType + '; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      });
      // Write in slices with gaps so the extension sees a genuine stream with
      // frame boundaries falling mid-chunk.
      let i = 0;
      const SLICE = 3000;
      const tick = () => {
        if (i >= text.length) { res.end(); return; }
        res.write(text.slice(i, i + SLICE));
        i += SLICE;
        setTimeout(tick, 12);
      };
      tick();
      req.on('aborted', () => { i = text.length; });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(Number(process.argv[2] || 8899)).then(() =>
    console.log('replay server on http://localhost:8899/?scenario=' + SCENARIO_NAMES.join('|')));
}
