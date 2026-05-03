// Load saved settings
chrome.storage.sync.get({
  maxQueries: 500,
  enabledSources: ['ChatGPT', 'Claude', 'Perplexity', 'Google Gemini', 'Microsoft Copilot'],
  autoExport: 'never'
}, (items) => {
  document.getElementById('maxQueries').value = items.maxQueries;
  document.getElementById('autoExport').value = items.autoExport;

  // Check enabled sources
  document.querySelectorAll('.source').forEach(checkbox => {
    checkbox.checked = items.enabledSources.includes(checkbox.value);
  });
});

// Save settings
document.getElementById('save').addEventListener('click', () => {
  const maxQueries = parseInt(document.getElementById('maxQueries').value) || 500;
  const autoExport = document.getElementById('autoExport').value;
  const enabledSources = Array.from(document.querySelectorAll('.source:checked'))
    .map(cb => cb.value);

  chrome.storage.sync.set({
    maxQueries,
    enabledSources,
    autoExport
  }, () => {
    const successMsg = document.getElementById('success');
    successMsg.style.display = 'block';
    setTimeout(() => {
      successMsg.style.display = 'none';
    }, 2000);
  });
});
