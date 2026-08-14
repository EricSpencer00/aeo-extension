# Chrome Web Store submission checklist

## Before uploading

- [x] `manifest_version` is 3
- [x] Version bumped (`2.0.0`) — the store rejects a re-upload of an existing version
- [x] No `<all_urls>`, no `activeTab`, no `tabs`, no `scripting` permission
- [x] Permissions limited to `storage` and `sidePanel`, plus eight named hosts
- [x] No localhost or `127.0.0.1` in the shipped manifest (`npm run pack` refuses it)
- [x] No remote code: no `eval`, no `new Function`, no externally hosted scripts
- [x] No analytics, telemetry or error reporting
- [x] Icons at 16, 48 and 128 px
- [x] `npm run test:all` green — 69 checks
- [x] Packaged zip verified live on perplexity.ai, claude.ai and chatgpt.com, signed in

## Build the package

```bash
npm run test:all
npm run pack        # -> aeo-extension-v2.0.0.zip
```

`pack.mjs` builds from an explicit allow-list. Tests, fixtures, captures and
tooling cannot end up in the upload.

## Dashboard fields

All the copy is in [STORE_LISTING.md](STORE_LISTING.md): name, short and long
description, category, single-purpose statement, permission justifications and
data-usage answers.

- Privacy policy URL: `https://github.com/EricSpencer00/aeo-extension/blob/main/PRIVACY.md`
  (must be reachable before submitting)
- Screenshots: `store/screenshot-1-timeline.png`, `-2-top.png`, `-3-privacy.png`
  — 1280×800, generated from a real capture by `node tools/make-store-assets.mjs`
- Data usage: answer **No** to every collection category

## What reviewers usually push back on, and the answer here

**Why does it need host access to those sites?**
It reads the responses those pages receive in order to recover the search
queries the assistant issued. That is the entire product. Access is limited to
six named hosts and the extension is inert everywhere else.

**Single purpose.**
Show the user the web search queries AI assistants ran on their behalf. Every
permission serves that; nothing in the package does anything else.

**Does it collect user data?**
No. Nothing leaves the device. There is no server to send it to and no network
code beyond re-reading a ChatGPT conversation the user already opened, in their
own session.

**Is any code remotely hosted?**
No. Every file is in the package.

## After approval

- [ ] Tag the release: `git tag v2.0.0 && git push --tags`
- [ ] Put the store URL in the README
- [ ] Re-run `node tools/test-live.mjs perplexity` after each site redesign; the
      Status tab in the panel is the early warning that a protocol changed
