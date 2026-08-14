# Chrome Web Store listing copy

Paste-ready text for the developer dashboard.

## Name (45 char max)

```
AEO Queries — See What AI Actually Searches
```

## Short description (132 char max)

```
See the exact search queries ChatGPT, Claude and Perplexity run for your prompts, so you know what your content has to rank for.
```

## Category

Developer Tools (alternate: Productivity → Workflow & Planning)

## Detailed description

```
When someone asks an AI assistant a question, the assistant does not search for their sentence. It rewrites it into several precise queries and searches those. The pages that rank for those rewritten queries are the pages the model reads, and the brands it names in its answer.

AEO Queries shows you those queries.

Ask Perplexity to compare two pairs of headphones and it runs searches like:

  Sony WH-1000XM6 vs Bose QuietComfort Ultra warranty
  site:bose.com QuietComfort Ultra Headphones warranty United States battery life 24 hours
  Sony WH-1000XM6 price Bose QuietComfort Ultra price Amazon Walmart Best Buy August 2026

Those exact strings are your optimisation targets. Guessing at them is the hard part of answer engine optimisation, and this extension removes the guessing.

WHAT YOU GET

• Timeline — every prompt paired with the queries it triggered
• Top queries — the same queries ranked by frequency, ready to hand to whoever writes your content
• Filtering by text and by assistant
• CSV export of timestamp, source, prompt and query
• One-click copy of any query or the whole visible set

SUPPORTED SITES

• Perplexity — every query it issues, including reformulations and site: operators
• Claude (claude.ai) — each web search tool call
• ChatGPT — browsing queries, when you are signed in
• Gemini and Copilot — best effort

Signed-out ChatGPT is the one gap, and it is OpenAI's: the anonymous web app tells the browser only that it searched, never what it searched for. Sign in and the queries come through.

PRIVACY

Everything stays in your browser. No account, no server, no analytics, no tracking. The extension makes no network requests of its own and sends nothing anywhere. Uninstalling deletes all of it.

Open source, MIT licensed: https://github.com/EricSpencer00/aeo-extension
```

## Permission justifications

**storage**
> Stores captured prompts and search queries locally so they persist between browser sessions. Nothing is transmitted.

**sidePanel**
> Displays the captured queries in Chrome's side panel alongside the AI conversation.

**Host access to chatgpt.com, chat.openai.com, claude.ai, perplexity.ai, gemini.google.com, copilot.microsoft.com**
> The extension reads the responses these sites deliver to the page in order to recover the search queries the assistant issued. Access is limited to exactly these sites; the extension is inert everywhere else. No page content beyond those network responses is read, and nothing is sent off the device.

**Remote code**
> None. All code is included in the package. No eval, no remotely hosted scripts.

## Single purpose statement

```
Surfacing the web search queries that AI assistants issue on the user's behalf, and showing them to the user for search optimisation research.
```

## Data usage disclosures

Answer "No" to every collection category. The extension transmits no data. It writes captured queries only to local extension storage on the user's own device.

## Privacy policy URL

https://github.com/EricSpencer00/aeo-extension/blob/main/PRIVACY.md

## Assets

| Asset | Size | File |
|---|---|---|
| Icon | 128×128 | `images/icon-128.png` |
| Screenshot 1 | 1280×800 | `store/screenshot-1-timeline.png` |
| Screenshot 2 | 1280×800 | `store/screenshot-2-top.png` |
| Screenshot 3 | 1280×800 | `store/screenshot-3-privacy.png` |

Regenerate with `node tools/make-store-assets.mjs`.
