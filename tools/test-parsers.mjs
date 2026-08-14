// Unit + fixture tests for parsers.js. Run: npm test
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const AEO = require(path.join(ROOT, 'parsers.js'));
const FIX = path.join(__dirname, 'fixtures');

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failures.push(name + ' — ' + e.message);
    console.log('  ✗ ' + name + '\n      ' + e.message);
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg || '') + `\n      expected ${b}\n      actual   ${a}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Feed a stream in small chunks so the SSE splitter is exercised at frame
// boundaries the way a real network delivers it.
function runStream(source, text, chunkSize = 97) {
  const out = [];
  const ex = AEO.createStreamExtractor(source, (q) => out.push(q));
  for (let i = 0; i < text.length; i += chunkSize) {
    ex.push(text.slice(i, i + chunkSize));
  }
  ex.finish();
  return out;
}

console.log('\nsource detection');
check('detects each supported host', () => {
  eq(AEO.detectSource('chatgpt.com'), 'ChatGPT');
  eq(AEO.detectSource('chat.openai.com'), 'ChatGPT');
  eq(AEO.detectSource('claude.ai'), 'Claude');
  eq(AEO.detectSource('www.claude.ai'), 'Claude');
  eq(AEO.detectSource('www.perplexity.ai'), 'Perplexity');
  eq(AEO.detectSource('gemini.google.com'), 'Google Gemini');
  eq(AEO.detectSource('example.com'), null);
});

console.log('\nquery validation');
check('accepts real search queries', () => {
  for (const q of [
    'best noise cancelling headphones for travel 2026',
    'site:sony.com WH-1000XM6 limited warranty',
    'AEO tools',
    'what is answer engine optimization',
  ]) assert(AEO.isPlausibleQuery(q), 'rejected: ' + q);
});

check('rejects ids, blobs, urls and markup', () => {
  for (const q of [
    '', 'x', 'null', 'undefined',
    '6a7e70f3-afac-83ea-99aa-b7c3f0a5531b',
    'deadbeefdeadbeefdeadbeefdeadbeef',
    'https://example.com/page',
    '{"a":1}',
    '<div>hi</div>',
    'line one\nline two',
    '1234567890',
    'a'.repeat(401),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnop',
  ]) assert(!AEO.isPlausibleQuery(q), 'accepted: ' + JSON.stringify(q));
});

console.log('\nSSE framing');
check('splits frames across arbitrary chunk boundaries', () => {
  const text = 'event: a\ndata: {"n":1}\n\ndata: {"n":2}\n\n';
  for (const size of [1, 3, 7, 13, 500]) {
    const p = AEO.createSSEParser();
    const frames = [];
    for (let i = 0; i < text.length; i += size) frames.push(...p.push(text.slice(i, i + size)));
    frames.push(...p.flush());
    eq(frames.map((f) => f.json.n), [1, 2], 'chunk size ' + size);
  }
});

check('handles CRLF and multi-line data', () => {
  const p = AEO.createSSEParser();
  const frames = p.push('event: x\r\ndata: {"a":\r\ndata: 1}\r\n\r\n');
  eq(frames.length, 1);
  eq(frames[0].json.a, 1);
});

check('recognises the [DONE] sentinel', () => {
  const p = AEO.createSSEParser();
  const frames = p.push('data: [DONE]\n\n');
  eq(frames[0].done, true);
});

console.log('\nClaude — Anthropic streaming protocol');
check('reassembles queries from input_json_delta fragments', () => {
  const text = fs.readFileSync(path.join(FIX, 'claude-websearch.sse'), 'utf8');
  eq(runStream('Claude', text), [
    'best noise cancelling headphones for travel 2026',
    'Sony WH-1000XM6 review battery life',
  ]);
});

check('handles claude.ai inline tool input and server_tool_use', () => {
  const text = fs.readFileSync(path.join(FIX, 'claude-ai-frontend.sse'), 'utf8');
  eq(runStream('Claude', text), [
    'chrome extension manifest v3 side panel best practices',
    'chrome web store review time 2026',
  ]);
});

check('ignores non-search tool calls', () => {
  const sse = [
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t","name":"repl","input":{}}}',
    '',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"query\\": \\"should not be captured\\"}"}}',
    '',
    'data: {"type":"content_block_stop","index":0}',
    '',
  ].join('\n');
  eq(runStream('Claude', sse), []);
});

check('extracts the human prompt from claude.ai request bodies', () => {
  eq(AEO.extractUserPrompt('Claude', JSON.stringify({ prompt: 'hello there' })), 'hello there');
  eq(
    AEO.extractUserPrompt('Claude', JSON.stringify({
      messages: [
        { role: 'assistant', content: 'earlier' },
        { role: 'human', content: [{ type: 'text', text: 'what should I rank for?' }] },
      ],
    })),
    'what should I rank for?'
  );
});

console.log('\nChatGPT');
check('captures web.run tool calls, search_model_queries and result groups', () => {
  const text = fs.readFileSync(path.join(FIX, 'chatgpt-websearch.sse'), 'utf8');
  const got = runStream('ChatGPT', text);
  for (const expected of [
    'best noise cancelling headphones travel 2026',
    'quietest ANC headphones long haul flight review',
    'top rated ANC over-ear headphones flights',
    'noise cancelling headphones best for airplanes',
  ]) assert(got.includes(expected), 'missing: ' + expected + '\n      got ' + JSON.stringify(got));
});

check('extracts the human prompt from a ChatGPT request body', () => {
  const body = JSON.stringify({
    action: 'next',
    messages: [{ id: 'x', author: { role: 'user' }, content: { content_type: 'text', parts: ['how do I rank in AI answers'] } }],
  });
  eq(AEO.extractUserPrompt('ChatGPT', body), 'how do I rank in AI answers');
});

check('captures queries delivered as JSON-pointer delta patches', () => {
  const sse = [
    'data: {"p":"/message/metadata/search_model_queries/queries/0","o":"add","v":"ergonomic chair lumbar support review"}',
    '',
    'data: {"p":"/message/metadata/search_model_queries/queries","o":"append","v":["best standing desk 2026"]}',
    '',
    'data: {"p":"/message/content/parts/0","o":"append","v":"some ordinary answer text"}',
    '',
  ].join('\n');
  eq(runStream('ChatGPT', sse), [
    'ergonomic chair lumbar support review',
    'best standing desk 2026',
  ]);
});

check('ignores patches whose path is unrelated to search', () => {
  const sse = 'data: {"p":"/message/content/parts/0","o":"append","v":"not a query"}\n\n';
  eq(runStream('ChatGPT', sse), []);
});

check('matches ChatGPT conversation endpoints incl. logged-out', () => {
  assert(AEO.isInterestingRequest('ChatGPT', 'https://chatgpt.com/backend-api/f/conversation', 'POST'));
  assert(AEO.isInterestingRequest('ChatGPT', 'https://chatgpt.com/backend-api/conversation', 'POST'));
  assert(AEO.isInterestingRequest('ChatGPT', 'https://chatgpt.com/backend-anon/conversation', 'POST'));
  assert(AEO.isInterestingRequest('ChatGPT', 'https://chatgpt.com/unauth-mweb/conversation/updates?operationId=1', 'POST'));
  assert(!AEO.isInterestingRequest('ChatGPT', 'https://chatgpt.com/ces/v1/t', 'POST'));
  assert(!AEO.isInterestingRequest('ChatGPT', 'https://chatgpt.com/backend-api/f/conversation', 'GET'));
});

console.log('\nPerplexity — replayed from live capture');
const CAP = path.join(FIX, 'perplexity-multistep.json');
check('recovers every issued query from a real multi-step search', () => {
  const cap = JSON.parse(fs.readFileSync(CAP, 'utf8'));
  const got = runStream('Perplexity', cap.resBody, 4096);
  eq(AEO.extractUserPrompt('Perplexity', cap.reqBody), cap.expectedPrompt);
  for (const q of cap.expectedQueries) {
    assert(got.includes(q), 'missing: ' + q + '\n      got ' + JSON.stringify(got, null, 1));
  }
  eq(got.length, cap.expectedQueries.length, 'unexpected extra queries: ' +
    JSON.stringify(got.filter((q) => !cap.expectedQueries.includes(q))));
});

check('matches the Perplexity SSE endpoint', () => {
  assert(AEO.isInterestingRequest('Perplexity', 'https://www.perplexity.ai/rest/sse/perplexity_ask', 'POST'));
  assert(!AEO.isInterestingRequest('Perplexity', 'https://www.perplexity.ai/rest/models/config/v2', 'GET'));
});

console.log('\nrobustness');
check('survives malformed and hostile payloads', () => {
  for (const bad of ['data: {oops\n\n', 'data: \n\n', '', 'garbage', 'data: null\n\n', 'data: []\n\n']) {
    runStream('Perplexity', bad);
  }
  eq(AEO.extractUserPrompt('Claude', 'not json'), null);
  eq(AEO.extractUserPrompt('Claude', null), null);
  eq(AEO.collectSearchQueries(null, [], 0), []);
});

check('does not recurse forever on cyclic objects', () => {
  const a = { name: 'web_search', input: {} };
  a.self = a;
  eq(AEO.collectSearchQueries(a, [], 0), []);
});

check('deduplicates repeated queries within a stream', () => {
  const frame = 'data: {"queries_payload":{"queries":["same query here"]}}\n\n';
  eq(runStream('Perplexity', frame.repeat(5)), ['same query here']);
});

console.log('\n' + (failures.length ? `FAILED ${failures.length}` : `all ${pass} checks passed`));
if (failures.length) {
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
