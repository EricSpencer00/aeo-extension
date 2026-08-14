# AEO Queries

A Chrome extension that shows the exact search queries AI assistants run when they answer your prompts.

Ask Perplexity to compare two products and it does not search for your sentence. It rewrites it into several precise queries and searches those:

```
prompt   compare the warranty and battery life of the Sony WH-1000XM6 and the
         Bose QuietComfort Ultra, and which retailer is cheapest right now

searches Sony WH-1000XM6 vs Bose QuietComfort Ultra warranty
         Sony WH-1000XM6 vs Bose QuietComfort Ultra battery life
         cheapest retailer for Sony WH-1000XM6 and Bose QuietComfort Ultra
         site:sony.com WH-1000XM6 warranty limited warranty United States battery 30 40 hours
         site:bose.com QuietComfort Ultra Headphones warranty United States battery life 24 hours
         Sony WH-1000XM6 price Bose QuietComfort Ultra price Amazon Walmart Best Buy August 2026
         Sony WH-1000XM6 "1-year" limited warranty United States
         Bose QuietComfort Ultra Headphones "1-year limited warranty"
         Sony WH-1000XM6 buy price Amazon Best Buy Walmart
```

Those nine strings are the ones that decide which pages the model reads, and
therefore which brands it names in the answer. They are what you optimise for.
This extension records them as they happen.

## Supported sites

| Site | What it captures | Verified against |
|---|---|---|
| Perplexity | Every query it issues, including reformulations and `site:` operators | Live — 9 queries from one prompt |
| Claude (claude.ai) | Each `web_search` tool call | Live, signed in — 3 queries from one prompt |
| ChatGPT | Browsing-tool queries, when signed in | Live, signed in — 11 queries from one prompt |
| Gemini, Copilot | Best effort | Not verified |

Each row above was checked by loading the packaged extension into Chrome,
asking the real site a real question, and reading what landed in storage.

Signed-out ChatGPT is the one gap, and it is OpenAI's: the anonymous web app
reports only "Searching 7 websites" and never sends the query text to the
browser. No extension can recover what the server does not deliver. Sign in and
the queries come through.

## Install

Until it is on the Chrome Web Store:

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on Developer mode.
3. Choose "Load unpacked" and select this folder.
4. Open an AI site, ask something that needs current information, and click the
   extension icon to open the side panel.

Full steps, including Brave and Edge, are in [INSTALL.md](INSTALL.md).

## Using it

The side panel has three views.

- **Timeline** — every prompt with the queries it triggered, newest first.
  Filter by text or by assistant.
- **Top queries** — the same queries ranked by how often they came up. This is
  the list to hand to whoever writes your content.
- **Status** — per-site capture counts, plus any response the extension read
  but could not find queries in. If a site changes its protocol, it shows up
  here first.

"Export CSV" gives you `timestamp, source, prompt, search_query` for a
spreadsheet. "Copy queries" puts the currently visible queries on the clipboard.

## Privacy

Everything stays in your browser's local extension storage. No account, no
server, no analytics, no network requests of its own. Uninstalling deletes it
all. See [PRIVACY.md](PRIVACY.md).

## How it works

A `MAIN`-world content script runs at `document_start`, before any page script,
and wraps `fetch`, `XMLHttpRequest` and `EventSource`. Response bodies are read
through a pass-through stream: the extension is the only reader of the original
body and re-emits every chunk untouched, so the page receives exactly what the
server sent. Queries are recovered by recognising the *shapes* that carry an
issued search — Anthropic `tool_use` blocks, OpenAI `web.run` arguments and
`search_model_queries`, Perplexity `queries_payload` — rather than one hard-coded
path per site, so a redesign that moves a field does not silently switch
capture off.

Architecture and the test strategy are described in
[DEVELOPMENT.md](DEVELOPMENT.md).

## Development

```bash
npm test          # parser unit tests, incl. replay of a real captured stream
npm run test:ui   # drives the side panel in Chrome and asserts on the DOM
npm run test:e2e  # loads the extension and replays real AI streams at it
npm run test:all  # all three
npm run pack      # build the Chrome Web Store zip
```

Against a real site:

```bash
node tools/test-live.mjs perplexity
node tools/test-live.mjs claude      # prompts you to sign in, once
node tools/test-live.mjs chatgpt
```

## Licence

MIT. See [LICENSE](LICENSE).
