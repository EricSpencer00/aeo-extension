# Installation Guide - AEO Queries Extension

## Quick Start (Developer Mode)

1. **Download/Clone the Extension**
   ```bash
   git clone https://github.com/EricSpencer00/aeo-extension.git
   cd aeo-extension
   ```

2. **Open Chrome Extensions**
   - Open Chrome and type: `chrome://extensions/` in the address bar
   - OR go to Menu (⋮) → More tools → Extensions

3. **Enable Developer Mode**
   - Toggle the **Developer mode** switch in the top-right corner

4. **Load the Extension**
   - Click **Load unpacked**
   - Navigate to your `aeo-extension` folder and select it
   - Click **Select Folder**

5. **You're Done!**
   - The extension now appears in your extensions list
   - Click the extension icon to open the popup
   - You should see the AEO Queries icon in your toolbar

## Usage

### First Run
1. Open ChatGPT, Claude, Perplexity, or another supported AI interface
2. Ask a question that requires a web search
3. Open the AEO Queries extension (click the icon in your toolbar)
4. You should see the captured search query!

### Features
- **View Queries**: All captured queries appear in the popup with source and timestamp
- **Filter by Source**: Click source buttons to filter queries by AI service
- **Copy Queries**: Click "Copy" on any query to copy it to your clipboard
- **Export Data**: Click "Export CSV" to download all queries as a CSV file
- **Clear Data**: Click "Clear All" to delete all captured queries
- **Settings**: Click "Settings" to configure monitoring preferences

## Updating the Extension

If you cloned from GitHub:
```bash
git pull origin main
# Refresh the extension on chrome://extensions/
```

## Troubleshooting

**Queries Not Appearing?**
- ✓ Make sure you're on a supported AI interface (ChatGPT, Claude, Perplexity, etc.)
- ✓ Check that the extension shows as "Enabled" on chrome://extensions/
- ✓ Try asking a question that requires a web search
- ✓ Refresh the page and try again

**Extension Not Showing in Toolbar?**
- ✓ Go to chrome://extensions/
- ✓ Make sure "AEO Queries" is listed and enabled
- ✓ Click the extension icon (puzzle piece) in your toolbar
- ✓ Click the pin icon next to "AEO Queries" to pin it

**Getting Errors?**
- ✓ Open Chrome DevTools (F12) and check the Console tab for errors
- ✓ Try reloading the extension on chrome://extensions/ (click the refresh icon)
- ✓ Clear your Chrome cache and reload

**Data Not Persisting?**
- ✓ Make sure you're not in Incognito mode (extensions don't store data there)
- ✓ Check that "Allow in Incognito" is toggled off on chrome://extensions/

## For Developers

### File Structure
```
aeo-extension/
├── manifest.json        # Extension configuration
├── background.js        # Background service worker (query capture)
├── content.js          # Content script for page injection
├── popup.html          # Extension popup UI
├── popup.js            # Popup functionality
├── options.html        # Settings page
├── options.js          # Settings functionality
├── images/             # Extension icons
├── README.md           # Main documentation
├── LICENSE             # MIT License
└── package.json        # Project metadata
```

### Making Changes
1. Edit the files you want to change
2. Go to chrome://extensions/
3. Click the refresh icon on the AEO Queries extension card
4. Test your changes

### Testing Tips
- Use Chrome DevTools → Application tab to inspect:
  - Local Storage (stored queries)
  - Service Worker logs
- Use chrome://extension-crash-dumps to debug crashes

## Chrome Web Store Submission (Coming Soon)

The extension is ready for Chrome Web Store submission. To submit:
1. Create a developer account at https://chromewebstore.google.com/
2. Create a new item
3. Upload the extension folder as a ZIP file
4. Fill in store details (description, screenshots, etc.)
5. Submit for review

## Need Help?

- 📝 Check the [README.md](README.md) for feature overview
- 🐛 Report issues on [GitHub Issues](https://github.com/EricSpencer00/aeo-extension/issues)
- 💡 Have a suggestion? Open a GitHub Discussion

---

Happy AEO optimization! 🚀
