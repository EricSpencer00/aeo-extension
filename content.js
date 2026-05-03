// Inject script into page to intercept fetch/XHR calls with search queries
const script = document.createElement('script');
script.textContent = `
(function() {
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;

  // Intercept fetch
  window.fetch = function(...args) {
    const url = args[0];
    const init = args[1];

    // Check for search-related requests
    if (typeof url === 'string' && isSearchUrl(url)) {
      const queries = extractQueriesFromUrl(url);
      if (queries.length > 0) {
        queries.forEach(q => sendQuery(q));
      }
    }

    // Check request body for queries
    if (init && init.body) {
      const queries = extractQueriesFromBody(init.body);
      if (queries.length > 0) {
        queries.forEach(q => sendQuery(q));
      }
    }

    return originalFetch.apply(this, args);
  };

  // Intercept XHR
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (isSearchUrl(url)) {
      const queries = extractQueriesFromUrl(url);
      if (queries.length > 0) {
        queries.forEach(q => sendQuery(q));
      }
    }

    this._originalSend = this.send;
    this.send = function(body) {
      if (body) {
        const queries = extractQueriesFromBody(body);
        if (queries.length > 0) {
          queries.forEach(q => sendQuery(q));
        }
      }
      return this._originalSend.call(this, body);
    };

    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  function isSearchUrl(url) {
    const searchIndicators = ['search', 'query', 'retrieve', 'google', 'bing', 'api', 'v1'];
    return searchIndicators.some(indicator => url.toLowerCase().includes(indicator));
  }

  function extractQueriesFromUrl(url) {
    const queries = [];
    try {
      const urlObj = new URL(url, window.location.origin);
      const params = ['q', 'query', 'search', 'searchQuery', 'search_query', 'searchTerm'];

      params.forEach(param => {
        const value = urlObj.searchParams.get(param);
        if (value && value.length > 2 && value.length < 500) {
          queries.push(value);
        }
      });
    } catch (e) {
      // Invalid URL
    }
    return queries;
  }

  function extractQueriesFromBody(body) {
    const queries = [];
    try {
      let obj;
      if (typeof body === 'string') {
        obj = JSON.parse(body);
      } else if (body instanceof FormData) {
        return queries;
      } else {
        obj = body;
      }

      const patterns = ['search', 'query', 'searchQuery', 'search_query'];
      recursiveSearch(obj, patterns, queries);
    } catch (e) {
      // Not JSON, try regex
      if (typeof body === 'string') {
        const regex = /["\']?(search|query|searchQuery)["\']?\s*[:=]\s*["\']([^"']+)["\']/gi;
        let match;
        while ((match = regex.exec(body)) !== null) {
          const query = match[2];
          if (query.length > 2 && query.length < 500) {
            queries.push(query);
          }
        }
      }
    }
    return [...new Set(queries)];
  }

  function recursiveSearch(obj, patterns, queries, depth = 0) {
    if (depth > 5 || typeof obj !== 'object' || obj === null) return;

    for (const key in obj) {
      const value = obj[key];
      if (patterns.some(p => key.toLowerCase().includes(p))) {
        if (typeof value === 'string' && value.length > 2 && value.length < 500) {
          queries.push(value);
        }
      }
      if (typeof value === 'object' && value !== null) {
        recursiveSearch(value, patterns, queries, depth + 1);
      }
    }
  }

  function sendQuery(query) {
    // Send to background script
    chrome.runtime.sendMessage({
      type: 'QUERY_DETECTED',
      query: query.trim(),
      url: window.location.href
    }).catch(e => {
      // Extension not ready, ignore
    });
  }
})();
`;

document.documentElement.appendChild(script);
script.remove();

// Listen for messages from injected script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'QUERY_DETECTED') {
    // Forward to background script
    chrome.runtime.sendMessage(request);
  }
});
