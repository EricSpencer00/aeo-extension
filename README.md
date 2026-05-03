# AEO Queries - Chrome Extension

See what ChatGPT, Claude, Perplexity, and other AI interfaces are actually searching for. Perfect for AEO (AI Engine Optimization) and SEO research.

## Features

- **Real-time Query Capture**: Automatically captures search queries made by AI interfaces
- **Multi-AI Support**: Works with ChatGPT, Claude, Perplexity, Google Gemini, Microsoft Copilot
- **Easy Filtering**: Filter results by AI source
- **Export to CSV**: Download all captured queries for analysis
- **Query Statistics**: See breakdown of queries by source
- **No Data Logging**: All data stored locally on your device

## How It Works

When you use an AI chat interface to ask a question, the AI often needs to search the web to provide current information. This extension captures those search queries in real-time, showing you:

1. What queries the AI is making
2. Which AI interface made the query
3. When the query was made

This helps you understand what keywords and search patterns AI uses, which is valuable for SEO optimization.

## Installation

### Option 1: Install from Chrome Web Store (Coming Soon)
Soon available on the [Chrome Web Store](https://chromewebstore.google.com)

### Option 2: Manual Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `aeo-extension` folder
6. The extension appears in your extensions list!

## Usage

1. Click the **AEO Queries** icon in your Chrome toolbar
2. Open your favorite AI chat (ChatGPT, Claude, Perplexity, etc.)
3. Ask a question - the extension will capture any searches the AI makes
4. Return to the popup to see captured queries
5. Use filters to view queries from specific AI services
6. Click **Copy** to copy any query, or **Export CSV** to download all

## Settings

Click **Settings** in the popup to:
- Adjust maximum number of stored queries
- Enable/disable monitoring for specific AI services
- Configure auto-export options

## Privacy

- **100% Local**: All captured data is stored locally on your device in Chrome's storage
- **No Servers**: No data is sent to any external servers
- **No Tracking**: We don't track your usage or queries
- **Clear Anytime**: Delete all captured queries with one click

## Troubleshooting

**Queries not appearing?**
- Make sure you're on a supported AI interface
- Check that the extension is enabled
- Try refreshing the page

**Want to clear data?**
- Open the extension popup and click "Clear All"

**Export not working?**
- Make sure you have captured at least one query
- Check your download folder

## Supported AI Interfaces

- ✅ ChatGPT (chatgpt.com, chat.openai.com)
- ✅ Claude (claude.ai)
- ✅ Perplexity (perplexity.ai)
- ✅ Google Gemini (gemini.google.com)
- ✅ Microsoft Copilot (copilot.microsoft.com)

More coming soon!

## Development

```bash
# Clone the repo
git clone https://github.com/EricSpencer00/aeo-extension.git
cd aeo-extension

# Load in Chrome developer mode
# chrome://extensions/ → Load unpacked → select folder
```

## Contributing

Issues and pull requests welcome! Please include:
- Description of the feature or bug
- Steps to reproduce (for bugs)
- Screenshots if helpful

## License

MIT License - see LICENSE file

## Disclaimer

This extension is for research and optimization purposes only. Always respect robots.txt and terms of service of websites. Use responsibly.

---

Made with ❤️ for the SEO community.

Questions? Open an issue on [GitHub](https://github.com/EricSpencer00/aeo-extension/issues)
