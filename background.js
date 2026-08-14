// Service worker: owns persistence. Content scripts only report; all writes
// happen here, serialised through a single promise chain so concurrent
// messages from several tabs cannot clobber each other's read-modify-write.

const MAX_TURNS = 500;
const MAX_DIAGNOSTICS = 25;

try {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
} catch (_) {}

chrome.action.onClicked.addListener((tab) => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open) chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (_) {}
});

// ── Serialised storage access ───────────────────────────────────────────────
let chain = Promise.resolve();

function withStore(fn) {
  chain = chain.then(() => fn()).catch((e) => console.warn('[AEO] store error', e));
  return chain;
}

function get(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function set(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

// ── Messages ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'AEO_TURN':
      withStore(() => addTurn(msg));
      break;
    case 'AEO_QUERY':
      withStore(() => addQuery(msg));
      break;
    case 'AEO_DIAGNOSTIC':
      withStore(() => addDiagnostic(msg));
      break;
    case 'AEO_CLEAR':
      withStore(async () => {
        await set({ turns: [], diagnostics: [] });
        sendResponse({ ok: true });
      });
      return true;
    default:
      break;
  }
});

async function addTurn(msg) {
  const { turns = [] } = await get('turns');
  if (turns.some((t) => t.id === msg.turnId)) return;
  turns.push({
    id: msg.turnId,
    source: msg.source || 'Unknown',
    prompt: msg.prompt || null,
    pageUrl: msg.pageUrl || null,
    ts: Date.now(),
    queries: [],
  });
  while (turns.length > MAX_TURNS) turns.shift();
  await set({ turns });
}

async function addQuery(msg) {
  const q = typeof msg.query === 'string' ? msg.query.trim() : '';
  if (!q) return;
  const { turns = [] } = await get('turns');

  let turn = turns.find((t) => t.id === msg.turnId);
  if (!turn) {
    turn = {
      id: msg.turnId || 'orphan-' + Date.now(),
      source: msg.source || 'Unknown',
      prompt: null,
      pageUrl: msg.pageUrl || null,
      ts: Date.now(),
      queries: [],
    };
    turns.push(turn);
    while (turns.length > MAX_TURNS) turns.shift();
  }
  if (turn.queries.some((x) => x.q === q)) return;
  turn.queries.push({ q, ts: Date.now() });
  await set({ turns });
}

async function addDiagnostic(msg) {
  const { diagnostics = [] } = await get('diagnostics');
  diagnostics.push({
    ts: Date.now(),
    source: msg.source || 'Unknown',
    url: shortenUrl(msg.url),
    info: msg.info || null,
  });
  while (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.shift();
  await set({ diagnostics });
}

function shortenUrl(u) {
  try {
    const url = new URL(u, 'https://example.invalid');
    return url.origin === 'https://example.invalid' ? String(u).slice(0, 120) : url.origin + url.pathname;
  } catch (_) {
    return String(u || '').slice(0, 120);
  }
}
