# Install

## From source

The extension is not on the Chrome Web Store yet, so install it unpacked.

1. Get the code.

   ```bash
   git clone https://github.com/EricSpencer00/aeo-extension.git
   ```

   Or download the ZIP from GitHub and unzip it. Keep the folder somewhere
   permanent — Chrome loads it from that path on every start, so an unpacked
   extension in Downloads breaks when you tidy up.

2. Open the extensions page.

   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`

3. Turn on **Developer mode** (top right in Chrome and Brave, left sidebar in Edge).

4. Click **Load unpacked** and select the folder containing `manifest.json`.

5. Pin it: click the puzzle-piece icon in the toolbar and pin **AEO Queries**.

## Check that it works

1. Open [perplexity.ai](https://www.perplexity.ai/).
2. Ask something that needs current information and has more than one part, for
   example: *compare the warranty and battery life of two products you care
   about, and which retailer is cheapest.*
3. Click the extension icon. The side panel opens with your prompt and the exact
   queries Perplexity ran.

If the panel stays empty, open its **Status** tab. It lists what was captured
per site, and any response that was read but yielded no queries.

## Signing in matters for ChatGPT

Signed out, ChatGPT tells the browser only that it searched — never what it
searched for. The queries are not in the page, so nothing can recover them.
Sign in and they come through.

Claude and Perplexity work either way, though Claude needs an account to use at
all.

## Updating

```bash
git pull
```

Then click the refresh icon on the extension's card on the extensions page.
Captured queries survive an update.

## Uninstalling

Remove it from the extensions page. Everything it stored goes with it.
