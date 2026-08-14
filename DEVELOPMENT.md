# Development

## Layout

| File | Role |
|---|---|
| `parsers.js` | All query recovery logic. No DOM, no `chrome.*`. Loaded verbatim by the page-context script and by the Node tests, so the tested code is the shipped code. |
| `injected.js` | Runs in the page world at `document_start`. Wraps `fetch`, `XHR` and `EventSource`, taps responses, posts findings to the isolated world. |
| `content.js` | Isolated-world bridge. Relays messages to the service worker. |
| `background.js` | Owns persistence. All writes are serialised through one promise chain. |
| `popup.html` / `popup.js` | The side panel. |
| `options.html` / `options.js` | Settings and data deletion. |
| `tools/` | Tests, capture tooling and packaging. Never shipped. |

## Two rules that the design hangs on

**Never use `res.clone()` to tap a stream.** When a page aborts a streaming
response, the clone's buffer is torn down and everything captured is lost.
Perplexity aborts on every answer. `injected.js` instead becomes the sole reader
of the original body and hands the page a `ReadableStream` that re-emits each
chunk untouched. `tools/test-e2e.mjs` has a scenario that aborts mid-stream to
keep this honest.

**Interception must happen before the first page script.** Injecting a
`<script src>` from a content script is asynchronous, and a site can fire its
request before the patch lands. The manifest registers `parsers.js` and
`injected.js` as a `world: "MAIN"` content script at `document_start`, which
Chrome guarantees runs first.

## Recovering queries

`collectSearchQueries` walks parsed JSON looking for the *shapes* that carry an
issued search, not fixed paths:

- `queries_payload.queries` — Perplexity
- `search_model_queries.queries`, `search_result_groups[].search_query`,
  and `search_query: [{q}]` inside `web.run` arguments — ChatGPT
- `tool_use` / `server_tool_use` blocks whose name looks like a search tool,
  with the arguments reassembled from `input_json_delta` fragments — Claude

Anything recovered goes through `isPlausibleQuery`, which rejects UUIDs, hex
blobs, URLs, markup, multi-line text and oversized strings.

When a tapped response yields nothing, the extension stores a structural
fingerprint — field names and event names only, never content — visible in the
panel's Status tab. That is the signal that a site changed its protocol, and it
is enough to fix the parser without needing to reproduce the session.

## Testing

```bash
npm test           # parsers: units, fixtures, and replay of a real capture
npm run test:ui    # side panel and options page driven in a real Chrome
npm run test:e2e   # extension loaded in Chrome, real streams replayed at it
npm run test:all
```

Three fixtures are real captures rather than hand-written samples:

- `perplexity-multistep.json` — a verbatim Perplexity answer stream with the
  twelve queries it issued, replayed byte-for-byte.
- `claude-authed-real.sse` — the `web_search` tool blocks from a signed-in
  claude.ai completion stream, tool ids renamed.
- `chatgpt-authed-real.sse` — the two query-carrying frames from a signed-in
  ChatGPT stream, ids and tokens scrubbed.

The two signed-in captures were scrubbed before being committed and the tests
assert they contain no credentials. Together they mean a parser change that
would drop a query on a live site fails in CI-speed unit tests.

The end-to-end suite installs the extension through CDP's
`Extensions.loadUnpacked` (returns the extension id, and starts the worker,
which `--load-extension` does not do on a fresh profile) and asserts on what
landed in `chrome.storage.local`. `tools/make-test-build.mjs` produces the test
build and verifies every JS and HTML file is byte-identical to the source — only
the manifest differs, by the localhost match the replay server needs.

## Against real sites

```bash
node tools/test-live.mjs perplexity
node tools/test-live.mjs claude
node tools/test-live.mjs chatgpt
```

This loads the extension from the working tree into a fresh Chrome, types a
prompt, and prints what was captured. Sites needing an account open a window and
wait for you to sign in; the profile at `~/.aeo-live-profile` persists, so that
is a one-time step per site. Set `AEO_EXT_DIR` to test an unzipped store package
instead of the working tree.

## Capturing new protocol data

When a site changes, capture the ground truth rather than guessing:

```bash
./tools/launch-chrome.sh
node tools/capture.mjs --url https://www.perplexity.ai/ --out /tmp/cap.json \
     --prompt "a question that forces several searches" --wait 60
```

`tools/recorder.js` records every fetch, XHR, EventSource and WebSocket exchange
with full bodies. Inspect `/tmp/cap.json`, find the field carrying the queries,
add the shape to `collectSearchQueries`, and freeze the capture as a fixture.

## Packaging

```bash
npm run pack
```

Builds the zip from an explicit allow-list, refuses to package if the manifest
references a file that is not included, and refuses if the manifest grants
localhost or `<all_urls>` access.
