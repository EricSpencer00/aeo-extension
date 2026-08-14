// Isolated-world bridge. parsers.js and injected.js are registered separately
// as MAIN-world content scripts, so they patch fetch before any page script
// runs; this file only relays what they see to the service worker.

// Let the page-context code know whether to log verbosely.
chrome.storage.local.get('debug', (r) => {
  if (r && r.debug) window.postMessage({ __aeoType: 'AEO_CONFIG', debug: true }, '*');
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.__aeoType !== 'AEO') return;

  switch (msg.kind) {
    case 'turn':
      send({
        type: 'AEO_TURN',
        turnId: msg.turnId,
        source: msg.source,
        prompt: msg.prompt,
        pageUrl: location.href,
      });
      break;
    case 'query':
      send({
        type: 'AEO_QUERY',
        turnId: msg.turnId,
        source: msg.source,
        query: msg.query,
        pageUrl: location.href,
      });
      break;
    case 'diagnostic':
      send({
        type: 'AEO_DIAGNOSTIC',
        turnId: msg.turnId,
        source: msg.source,
        url: msg.url,
        info: msg.info,
      });
      break;
    default:
      break;
  }
});

function send(payload) {
  try {
    chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
  } catch (_) {
    // Extension context invalidated by a reload or update — nothing to do.
  }
}
