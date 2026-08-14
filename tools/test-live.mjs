// Live test: loads the shipping extension into Chrome, drives a real AI site,
// and reports what the extension actually captured from real traffic.
//
//   node tools/test-live.mjs perplexity
//   node tools/test-live.mjs claude "your prompt"
//   node tools/test-live.mjs chatgpt
//
// Sites that require an account are skipped with a clear message unless the
// profile at AEO_LIVE_PROFILE is already signed in.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Session, listTargets, newTab, sleep, waitFor } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.AEO_LIVE_PORT || 9444);
// Persistent by default: sign in once and every later run reuses the session.
const PROFILE = process.env.AEO_LIVE_PROFILE ||
  path.join(process.env.HOME || '/tmp', '.aeo-live-profile');
const CHROME = process.env.AEO_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SITES = {
  perplexity: {
    url: 'https://www.perplexity.ai/',
    source: 'Perplexity',
    needsLogin: false,
    // A comparison prompt forces multi-step search, so the run proves that
    // several distinct reformulated queries are captured, not just one.
    prompt: 'compare the warranty and battery life of the Sony WH-1000XM6 and the Bose QuietComfort Ultra, and which retailer is cheapest right now',
  },
  claude: {
    url: 'https://claude.ai/new',
    source: 'Claude',
    needsLogin: true,
    prompt: 'Search the web: what are the best answer engine optimization tools in 2026?',
  },
  chatgpt: {
    url: 'https://chatgpt.com/',
    source: 'ChatGPT',
    needsLogin: true,
    prompt: 'Search the web: best answer engine optimization tools in 2026',
  },
};

const COMPOSERS = [
  'div[contenteditable="true"]',
  '.ProseMirror',
  '[role="textbox"]',
  'textarea[placeholder]',
  'textarea',
  'input[type="search"]',
];

// Finds the message box. offsetParent is deliberately not used: it is null for
// anything inside a position:fixed container, which is how claude.ai lays its
// composer out. Returns the matching selector, or null.
const FIND_COMPOSER = `(() => {
  for (const sel of ${JSON.stringify(COMPOSERS)}) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 10 || el.disabled) continue;
      const visible = typeof el.checkVisibility === 'function'
        ? el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true })
        : true;
      if (visible) return sel;
    }
  }
  return null;
})()`;

async function main() {
  const which = (process.argv[2] || 'perplexity').toLowerCase();
  const site = SITES[which];
  if (!site) { console.error('unknown site:', which, '\nchoose:', Object.keys(SITES).join(', ')); process.exit(2); }
  const prompt = process.argv[3] || site.prompt;

  try { execSync(`pkill -f "user-data-dir=${PROFILE}"`, { stdio: 'ignore' }); } catch {}
  await sleep(1200);
  fs.mkdirSync(PROFILE, { recursive: true });

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGTERM'); } catch {} };
  process.on('exit', cleanup);

  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
  }, { timeout: 30000, label: 'chrome' });
  await sleep(2000);

  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await Session.attach(ver.webSocketDebuggerUrl);
  // AEO_EXT_DIR lets this run against an unzipped store package rather than
  // the working tree, so the artifact that gets uploaded is what was tested.
  const extDir = fs.realpathSync(process.env.AEO_EXT_DIR || ROOT);
  const { id: extId } = await browser.send('Extensions.loadUnpacked', { path: extDir });
  console.log('extension', extId, 'from', extDir);

  const swTarget = await waitFor(async () => {
    const targets = await listTargets(PORT);
    return targets.find((t) => t.url.includes(extId) && t.url.endsWith('/background.js'));
  }, { timeout: 30000, label: 'service worker' });
  const sw = await Session.attach(swTarget.webSocketDebuggerUrl);
  await sw.send('Runtime.enable');
  const swEval = async (expr) => {
    const r = await sw.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await swEval('new Promise(r => chrome.storage.local.clear(() => r(1)))');
  await swEval('new Promise(r => chrome.storage.local.set({debug: true}, () => r(1)))');

  console.log('opening', site.url);
  const tab = await newTab(site.url, PORT);
  const page = await Session.attach(tab.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  page.on('Runtime.consoleAPICalled', (p) => {
    const txt = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (txt.includes('[AEO]')) console.log('   page>', txt.slice(0, 180));
  });
  await sleep(7000);

  // Presence of a usable composer is the signal that the app is both loaded
  // and signed in. These SPAs render a marketing shell first, so a text scrape
  // a few seconds after navigation reports "logged out" on a signed-in account.
  const findComposer = async () => {
    const r = await page.send('Runtime.evaluate', { expression: FIND_COMPOSER, returnByValue: true });
    return r.result.value;
  };

  let composer = null;
  try {
    composer = await waitFor(findComposer, { timeout: 45000, interval: 2000, label: 'the app to load' });
  } catch (_) {
    const waitMin = Number(process.env.AEO_LOGIN_WAIT_MIN || 10);
    console.log('\n─────────────────────────────────────────────');
    console.log(`No message box on ${which} — probably not signed in.`);
    console.log(`A Chrome window is open on ${site.url}; sign in there and`);
    console.log('this test continues on its own.');
    console.log(`Waiting up to ${waitMin} minutes. The profile at`);
    console.log(`  ${PROFILE}`);
    console.log('persists, so this is a one-time step per site.');
    console.log('─────────────────────────────────────────────\n');
    try {
      composer = await waitFor(findComposer, { timeout: waitMin * 60000, interval: 5000, label: 'sign-in' });
      console.log('signed in — continuing\n');
      await sleep(4000);
    } catch (_e) {
      console.log('SKIPPED — no message box after ' + waitMin + ' minutes.');
      process.exit(3);
    }
  }
  console.log('composer:', composer);

  console.log('sending prompt:', prompt);
  const focused = await page.send('Runtime.evaluate', {
    expression: `(() => {
      const sel = ${JSON.stringify(composer)};
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 80 && r.height > 10 && !el.disabled) { el.focus(); el.click(); return sel; }
      }
      return null;
    })()`,
    returnByValue: true,
  });
  if (!focused.result.value) { console.error('could not focus the composer'); process.exit(1); }

  await sleep(700);
  await page.send('Input.insertText', { text: prompt });
  await sleep(900);
  for (const type of ['keyDown', 'keyUp']) {
    await page.send('Input.dispatchKeyEvent', {
      type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      text: type === 'keyDown' ? '\r' : undefined,
    });
  }

  console.log('waiting for the answer…');
  let turns = [];
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    turns = JSON.parse(await swEval(`new Promise(r => chrome.storage.local.get('turns', d => r(JSON.stringify(d.turns || []))))`));
    const n = turns.reduce((a, t) => a + t.queries.length, 0);
    process.stdout.write(`   t+${(i + 1) * 5}s turns=${turns.length} queries=${n}\r`);
    if (n > 0 && i >= 4) break;
  }
  console.log('');

  const diagnostics = JSON.parse(await swEval(`new Promise(r => chrome.storage.local.get('diagnostics', d => r(JSON.stringify(d.diagnostics || []))))`));

  console.log('\n─── captured ───');
  for (const t of turns) {
    console.log(`[${t.source}] prompt: ${t.prompt || '(none)'}`);
    if (!t.queries.length) console.log('    (no search queries)');
    for (const q of t.queries) console.log('    • ' + q.q);
  }
  if (diagnostics.length) {
    console.log('\n─── diagnostics (streams where nothing was found) ───');
    for (const d of diagnostics) {
      console.log(`[${d.source}] ${d.url}  ${d.info ? d.info.bytes + ' bytes' : ''}`);
      if (d.info) {
        console.log('   events: ' + (d.info.events.join(', ') || '(none)'));
        console.log('   keys:   ' + d.info.keys.join(' '));
      }
    }
  }

  const total = turns.reduce((a, t) => a + t.queries.length, 0);
  const ok = total > 0 && turns.some((t) => t.source === site.source);
  console.log('\n' + (ok
    ? `LIVE PASS — ${total} exact search quer${total === 1 ? 'y' : 'ies'} captured from ${site.source}`
    : `LIVE FAIL — nothing captured from ${site.source}`));
  cleanup();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
