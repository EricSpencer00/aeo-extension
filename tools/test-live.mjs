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
    loggedOut: (t) => /sign in|log in to claude|continue with google/i.test(t) && !/how can I help/i.test(t),
  },
  chatgpt: {
    url: 'https://chatgpt.com/',
    source: 'ChatGPT',
    needsLogin: true,
    prompt: 'Search the web: best answer engine optimization tools in 2026',
    loggedOut: (t) => /log in|sign up for free/i.test(t),
  },
};

const COMPOSERS = [
  'div[contenteditable="true"]',
  'textarea[placeholder]',
  'textarea',
  'input[type="search"]',
];

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

  const pageText = async () => {
    const r = await page.send('Runtime.evaluate', {
      expression: 'document.body.innerText.slice(0, 3000)', returnByValue: true,
    });
    return r.result.value || '';
  };

  if (site.needsLogin && site.loggedOut && site.loggedOut(await pageText())) {
    const waitMin = Number(process.env.AEO_LOGIN_WAIT_MIN || 10);
    console.log('\n─────────────────────────────────────────────');
    console.log(`Not signed in to ${which}. A Chrome window is open on ${site.url}.`);
    console.log('Sign in there and this test continues on its own.');
    console.log(`Waiting up to ${waitMin} minutes. The profile at`);
    console.log(`  ${PROFILE}`);
    console.log('persists, so this is a one-time step per site.');
    console.log('─────────────────────────────────────────────\n');
    try {
      await waitFor(async () => !site.loggedOut(await pageText()),
        { timeout: waitMin * 60000, interval: 5000, label: 'sign-in' });
      console.log('signed in — continuing\n');
      await sleep(4000);
    } catch (_) {
      console.log('SKIPPED — still signed out after ' + waitMin + ' minutes.');
      process.exit(3);
    }
  }

  console.log('sending prompt:', prompt);
  const focused = await page.send('Runtime.evaluate', {
    expression: `(() => {
      for (const sel of ${JSON.stringify(COMPOSERS)}) {
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width > 80 && r.height > 10 && !el.disabled && el.offsetParent !== null) {
            el.focus(); el.click(); return sel;
          }
        }
      }
      return null;
    })()`,
    returnByValue: true,
  });
  if (!focused.result.value) { console.error('could not find the composer'); process.exit(1); }

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
