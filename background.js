const AI_SOURCES = {
  chatgpt: {
    domains: ['chatgpt.com', 'chat.openai.com', 'openai.com'],
    name: 'ChatGPT',
    patterns: ['search', 'retrieve', 'query', 'web_search']
  },
  claude: {
    domains: ['claude.ai', 'anthropic.com'],
    name: 'Claude',
    patterns: ['search', 'retrieve', 'web_search', 'search_query']
  },
  perplexity: {
    domains: ['perplexity.ai'],
    name: 'Perplexity',
    patterns: ['search', 'query', 'web_search']
  },
  gemini: {
    domains: ['gemini.google.com', 'google.com'],
    name: 'Google Gemini',
    patterns: ['search', 'query', 'web_search']
  },
  copilot: {
    domains: ['copilot.microsoft.com', 'bing.com'],
    name: 'Microsoft Copilot',
    patterns: ['search', 'query']
  }
};

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Only process API requests
    if (!isApiRequest(details.url)) return;

    const tabUrl = new URL(details.url);
    const source = identifySource(tabUrl.hostname);

    if (!source) return;

    // Try to extract search queries from the request
    const queries = extractQueriesFromRequest(details, source);

    if (queries.length > 0) {
      queries.forEach(query => {
        saveQuery(query, source.name);
      });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!isApiRequest(details.url)) return;

    const tabUrl = new URL(details.url);
    const source = identifySource(tabUrl.hostname);

    if (!source) return;

    // Parse URL for query parameters
    const params = new URLSearchParams(tabUrl.search);
    const queries = extractQueriesFromParams(params, source);

    if (queries.length > 0) {
      queries.forEach(query => {
        saveQuery(query, source.name);
      });
    }
  },
  { urls: ['<all_urls>'] }
);

// Monitor for requests to Google Search API (used by most AI services)
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const url = new URL(details.url);

    // Detect Google Search API calls
    if (url.hostname.includes('google.') &&
        (url.pathname.includes('/search') ||
         url.pathname.includes('/api/') ||
         url.search.includes('q='))) {

      const source = identifySourceFromTab(details.tabId);
      if (!source) return;

      const queries = extractQueriesFromUrl(url);
      queries.forEach(query => saveQuery(query, source));
    }

    // Detect Bing Search API calls
    if (url.hostname.includes('bing.') && url.search.includes('q=')) {
      const source = identifySourceFromTab(details.tabId);
      if (!source) return;

      const q = url.searchParams.get('q');
      if (q) saveQuery(q, source);
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

function isApiRequest(url) {
  return url.includes('/api/') ||
         url.includes('/graphql') ||
         url.includes('search') ||
         url.includes('query');
}

function identifySource(hostname) {
  for (const [key, config] of Object.entries(AI_SOURCES)) {
    if (config.domains.some(domain => hostname.includes(domain))) {
      return config;
    }
  }
  return null;
}

function identifySourceFromTab(tabId) {
  // This would require more complex tracking, fallback to 'Unknown'
  return 'Unknown';
}

function extractQueriesFromRequest(details, source) {
  const queries = [];

  // Check request body for query strings
  if (details.requestBody) {
    const bodyStr = getRequestBodyAsString(details.requestBody);
    if (bodyStr) {
      const extracted = parseJsonForQueries(bodyStr, source.patterns);
      queries.push(...extracted);
    }
  }

  return queries;
}

function extractQueriesFromParams(params, source) {
  const queries = [];

  // Common query parameter names
  const queryParams = ['q', 'query', 'search', 'searchQuery', 'search_query', 'searchTerm'];

  for (const param of queryParams) {
    const value = params.get(param);
    if (value) {
      queries.push(value);
    }
  }

  return queries;
}

function extractQueriesFromUrl(url) {
  const queries = [];
  const queryParams = ['q', 'query', 'search'];

  for (const param of queryParams) {
    const value = url.searchParams.get(param);
    if (value) {
      queries.push(value);
    }
  }

  return queries;
}

function getRequestBodyAsString(body) {
  if (body.raw) {
    try {
      return body.raw.map(item => {
        if (item.bytes) {
          return new TextDecoder().decode(item.bytes);
        }
        return '';
      }).join('');
    } catch (e) {
      return null;
    }
  }
  if (body.formData) {
    return JSON.stringify(body.formData);
  }
  return null;
}

function parseJsonForQueries(str, patterns) {
  const queries = [];

  try {
    // Try to parse as JSON
    const obj = JSON.parse(str);
    const extracted = searchObjectForQueries(obj, patterns);
    queries.push(...extracted);
  } catch (e) {
    // Try regex patterns
    patterns.forEach(pattern => {
      const regex = new RegExp(`${pattern}["\']?\s*[:=]\s*["\']([^"']+)["\']`, 'gi');
      let match;
      while ((match = regex.exec(str)) !== null) {
        const query = match[1];
        if (query.length > 2 && query.length < 500) {
          queries.push(query);
        }
      }
    });
  }

  return [...new Set(queries)]; // Remove duplicates
}

function searchObjectForQueries(obj, patterns, depth = 0) {
  const queries = [];

  if (depth > 5) return queries; // Prevent infinite recursion

  if (typeof obj !== 'object' || obj === null) {
    return queries;
  }

  for (const key in obj) {
    const value = obj[key];

    // Check if key matches patterns
    if (patterns.some(p => key.toLowerCase().includes(p))) {
      if (typeof value === 'string' && value.length > 2 && value.length < 500) {
        if (!value.includes('<') && !value.includes('{')) { // Likely not HTML/JSON
          queries.push(value);
        }
      }
    }

    // Recurse into nested objects
    if (typeof value === 'object' && value !== null) {
      queries.push(...searchObjectForQueries(value, patterns, depth + 1));
    }
  }

  return [...new Set(queries)];
}

function saveQuery(query, source) {
  // Filter out noise and very short queries
  if (!query || query.trim().length < 2 || query.length > 1000) {
    return;
  }

  // Filter out common noise
  const noise = ['undefined', 'null', 'true', 'false', 'error', '{}', '[]'];
  if (noise.includes(query.toLowerCase().trim())) {
    return;
  }

  chrome.storage.local.get('queries', (result) => {
    const queries = result.queries || [];

    // Avoid duplicates within last 30 seconds
    const recentDuplicate = queries.some(q =>
      q.query === query &&
      q.source === source &&
      (Date.now() - q.timestamp) < 30000
    );

    if (recentDuplicate) {
      return;
    }

    queries.push({
      query: query.trim(),
      source: source,
      timestamp: Date.now()
    });

    // Keep only last 500 queries
    if (queries.length > 500) {
      queries.shift();
    }

    chrome.storage.local.set({ queries });
  });
}
