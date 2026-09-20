const debugEl = document.getElementById('debug');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');

chrome.storage.local.get(['debug', 'turns', 'diagnostics'], (d) => {
  debugEl.checked = !!d.debug;
  showStats(d.turns || [], d.diagnostics || []);
});

debugEl.addEventListener('change', () => {
  chrome.storage.local.set({ debug: debugEl.checked }, () => {
    statusEl.textContent = debugEl.checked
      ? 'Debug logging on — reload the AI tab to apply.'
      : 'Debug logging off.';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  });
});

document.getElementById('clear').addEventListener('click', clearStoredData);

function clearStoredData() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'AEO_CLEAR' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        statusEl.textContent = 'Delete failed.';
        resolve(false);
        return;
      }
      showStats([], []);
      statusEl.textContent = 'Deleted.';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
      resolve(true);
    });
  });
}

function showStats(turns, diagnostics) {
  const queries = turns.reduce((a, t) => a + t.queries.length, 0);
  statsEl.textContent =
    `${queries} search quer${queries === 1 ? 'y' : 'ies'} across ${turns.length} prompt` +
    `${turns.length === 1 ? '' : 's'}, and ${diagnostics.length} diagnostic record` +
    `${diagnostics.length === 1 ? '' : 's'}.`;
}
