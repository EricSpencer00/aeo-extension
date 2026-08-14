# Privacy policy

**AEO Queries** — last updated 13 August 2026.

## What the extension collects

On the AI sites listed in its manifest, the extension records:

- the prompt you typed,
- the search queries the assistant sent to a search engine in response,
- the timestamp, the assistant's name, and the page URL,
- for responses it could not read, the *field names* present in them and the
  response size. No message content is kept in these diagnostic records.

## Where it goes

Into `chrome.storage.local` on your own computer. That is the whole list.

The extension has no server, makes no network requests of its own, and contains
no analytics, telemetry, error reporting or advertising code. Nothing is sent to
the developer or to any third party. Nothing is shared or sold.

The only network activity is the extension re-reading a conversation you already
opened on ChatGPT, using your existing signed-in session, to recover queries the
live stream did not include. That request goes to ChatGPT and nowhere else.

## How long it is kept

Until you delete it. The extension keeps the 500 most recent prompts and
discards older ones automatically. "Clear" in the side panel, "Delete
everything" on the options page, or uninstalling the extension removes the data
immediately.

## Permissions and why

- `storage` — to keep captured queries between browser sessions.
- `sidePanel` — to show the results in Chrome's side panel.
- Host access to chatgpt.com, chat.openai.com, claude.ai, perplexity.ai,
  gemini.google.com and copilot.microsoft.com — to read the responses those
  pages receive. The extension is inert on every other site.

The extension does not request access to all sites, does not read page content
beyond those network responses, and does not touch your credentials or cookies.

## Contact

Eric Spencer — ericspencer1450@gmail.com
Source code: https://github.com/EricSpencer00/aeo-extension
