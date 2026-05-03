# Development Guide

## Architecture Overview

The extension uses a three-layer architecture:

```
Content Script (content.js)
    ↓ (detects searches on AI pages)
Background Service Worker (background.js)
    ↓ (processes & stores queries)
Chrome Storage API
    ↓ (retrieves data)
Popup UI (popup.js/popup.html)
```

## Components

### 1. **background.js** (Service Worker)
The core of the extension. Responsibilities:
- Intercepts network requests using `webRequest` API
- Identifies search queries from different AI sources
- Filters and deduplicates queries
- Stores queries in Chrome's local storage

**Key Functions:**
- `identifySource(hostname)` - Determines which AI service made the request
- `extractQueriesFromRequest(details, source)` - Extracts queries from HTTP requests
- `parseJsonForQueries(str, patterns)` - Parses JSON looking for search queries
- `saveQuery(query, source)` - Persists queries to storage

### 2. **content.js** (Content Script)
Runs on AI interface pages (ChatGPT, Claude, etc.). Responsibilities:
- Injects code into page context to intercept fetch/XHR calls
- Detects search queries at the JavaScript level
- Communicates findings to the background worker

**How It Works:**
1. Overrides `window.fetch` and `XMLHttpRequest.prototype.open`
2. Intercepts requests to search APIs
3. Extracts query parameters from URLs and request bodies
4. Sends detected queries to the background service worker

### 3. **popup.js/popup.html** (UI)
User-facing interface. Responsibilities:
- Displays captured queries
- Provides filtering and search
- Allows exporting to CSV
- Shows statistics and metadata

## Adding Support for New AI Services

To add support for a new AI interface:

### Step 1: Update `background.js`

Add to the `AI_SOURCES` object:
```javascript
const AI_SOURCES = {
  // ... existing sources
  myai: {
    domains: ['myai.com', 'www.myai.com'],
    name: 'My AI Service',
    patterns: ['search', 'query', 'retrieve']
  }
};
```

### Step 2: Update `manifest.json`

Add to `host_permissions`:
```json
"host_permissions": [
  // ... existing
  "https://myai.com/*",
  "https://www.myai.com/*"
]
```

Add to `content_scripts` matches:
```json
"content_scripts": [
  {
    "matches": [
      // ... existing
      "https://myai.com/*",
      "https://www.myai.com/*"
    ],
    "js": ["content.js"],
    "run_at": "document_start"
  }
]
```

### Step 3: Test

1. Reload the extension on `chrome://extensions/`
2. Open the new AI interface
3. Ask a question
4. Check if queries appear in the popup

## Debugging

### Using Chrome DevTools

1. Go to `chrome://extensions/`
2. Find "AEO Queries" and click "Inspect views" → "service worker"
3. DevTools opens with background.js context
4. Add console.logs to `background.js` to debug

### Viewing Stored Data

In DevTools on any page:
```javascript
chrome.storage.local.get('queries', (result) => {
  console.log(result.queries);
});
```

### Testing Network Interception

1. Open DevTools on an AI chat page (F12)
2. Go to Network tab
3. Ask a question
4. Look for API calls that might contain search queries
5. Check the request and response bodies

## Query Extraction Logic

The extension uses multiple strategies to find queries:

### 1. URL Parameters
Looks for common parameter names: `q`, `query`, `search`, `searchQuery`
```javascript
// Example: https://api.example.com/search?q=best+gardening+supplies
```

### 2. JSON Request Bodies
Parses request bodies looking for keys matching patterns like "search", "query"
```javascript
// Example: {"search": "best gardening supplies"}
```

### 3. Regex Patterns
Falls back to regex when JSON parsing fails
```javascript
// Matches: search":"best gardening supplies"
```

## Storage Format

Queries are stored in Chrome's local storage as JSON:

```javascript
{
  "queries": [
    {
      "query": "best gardening supplies chicago",
      "source": "ChatGPT",
      "timestamp": 1715785000000
    },
    // ... more queries
  ]
}
```

**Storage Limits:**
- Max 500 queries (configurable in settings)
- ~10MB available per extension
- Auto-removes oldest queries when limit reached

## Performance Considerations

### Efficiency
- **Deduplication**: Prevents saving the same query twice within 30 seconds
- **Filtering**: Ignores noise like `null`, `undefined`, very short strings
- **Caching**: Stores in memory to avoid repeated lookups

### Optimization Opportunities
1. Add compression for old queries
2. Implement batch exports
3. Add background sync to export data periodically
4. Cache regex patterns for faster matching

## Testing Scenarios

### Scenario 1: ChatGPT Search
1. Go to ChatGPT
2. Ask: "What are the best gardening supplies for Chicago?"
3. Wait for response
4. Check popup - should see search queries

### Scenario 2: Multiple AI Services
1. Open ChatGPT in one tab, Claude in another
2. Ask similar questions to both
3. Check popup - should see queries from both sources labeled correctly

### Scenario 3: Export Data
1. Capture several queries
2. Click "Export CSV"
3. Verify CSV contains all queries with correct metadata

### Scenario 4: Filtering
1. Capture queries from multiple sources
2. Click source filter buttons
3. Verify only that source's queries appear

## Common Issues & Solutions

### Issue: Queries not being captured
**Solution:**
- Check if page is in host_permissions
- Verify content script is running (check console)
- Try a different search term
- Check if the AI is actually making web requests

### Issue: Duplicates appearing
**Solution:**
- The 30-second deduplication should prevent this
- Try clearing storage and retrying
- Check if query is slightly different (different formatting)

### Issue: Performance lag
**Solution:**
- Check if storing too many queries (500+ limit)
- Clear old queries via popup
- Check for memory leaks in background worker

## Future Features

Potential enhancements to consider:

1. **Analytics Dashboard**
   - Search volume trends
   - Most common queries
   - Query patterns by AI service

2. **Smart Filtering**
   - Filter by date range
   - Search within queries
   - Group by intent/category

3. **Integration**
   - Direct export to Google Sheets
   - Slack notifications
   - SEMrush/Ahrefs integration

4. **Query Enhancement**
   - Show search results for each query
   - Track which results the AI used
   - Show confidence/relevance scores

5. **Multi-Device Sync**
   - Sync queries across devices
   - Cloud backup (privacy-respecting)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

## Resources

- [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- [Web Request API](https://developer.chrome.com/docs/extensions/reference/webRequest/)
- [Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)
- [Content Scripts](https://developer.chrome.com/docs/extensions/content_scripts/)

---

Questions? Open an issue on [GitHub](https://github.com/EricSpencer00/aeo-extension/issues)
