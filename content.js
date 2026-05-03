// Inject the page-context script as early as possible
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
s.onload = () => s.remove();
(document.head || document.documentElement).prepend(s);

// Bridge: receive postMessages from injected.js and forward to background
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || !msg.__aeoType) return;

  if (msg.__aeoType === 'QUERY') {
    const query = (msg.query || '').trim();
    if (!query || query.length < 2 || query.length > 1000) return;
    chrome.runtime.sendMessage({
      type: 'QUERY_DETECTED',
      query,
      source: msg.source || detectSource(),
      webSearch: !!msg.webSearch,
    });
  }
});

function detectSource() {
  const h = location.hostname;
  if (h.includes('chatgpt.com') || h.includes('openai.com')) return 'ChatGPT';
  if (h.includes('claude.ai')) return 'Claude';
  if (h.includes('perplexity.ai')) return 'Perplexity';
  if (h.includes('gemini.google.com')) return 'Google Gemini';
  if (h.includes('copilot.microsoft.com')) return 'Microsoft Copilot';
  return 'Unknown AI';
}
