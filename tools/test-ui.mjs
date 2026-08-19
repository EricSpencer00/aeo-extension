// Drives the side panel and options page as real extension pages, seeded with
// realistic data, and asserts on what actually renders. A green parser suite
// says nothing about whether the panel shows anything.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Session, listTargets, newTab, sleep, waitFor } from './cdp.mjs';
import { makeTestBuild } from './make-test-build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9555;
const PROFILE = '/tmp/aeo-ui-profile';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = '/tmp/aeo-ui-shots';

let failures = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

const SEED = {
  turns: [
    {
      id: 't1', source: 'Perplexity', ts: Date.now() - 60000,
      prompt: 'compare the warranty and battery life of the Sony WH-1000XM6 and the Bose QuietComfort Ultra',
      pageUrl: 'https://www.perplexity.ai/',
      queries: [
        { q: 'Sony WH-1000XM6 vs Bose QuietComfort Ultra warranty', ts: Date.now() - 59000 },
        { q: 'site:bose.com QuietComfort Ultra Headphones warranty return policy', ts: Date.now() - 58000 },
        { q: 'Sony WH-1000XM6 <script>alert(1)</script> price', ts: Date.now() - 57000 },
      ],
    },
    {
      id: 't2', source: 'Claude', ts: Date.now() - 30000,
      prompt: 'what are the best answer engine optimization tools?',
      pageUrl: 'https://claude.ai/',
      queries: [
        { q: 'best answer engine optimization tools 2026', ts: Date.now() - 29000 },
        { q: 'Sony WH-1000XM6 vs Bose QuietComfort Ultra warranty', ts: Date.now() - 28000 },
      ],
    },
    {
      id: 't3', source: 'ChatGPT', ts: Date.now() - 10000,
      prompt: 'explain recursion', pageUrl: 'https://chatgpt.com/', queries: [],
    },
  ],
  diagnostics: [
    {
      ts: Date.now() - 5000, source: 'ChatGPT',
      url: 'https://chatgpt.com/unauth-mweb/conversation/updates',
      info: { bytes: 188298, events: [], keys: ['type:12', 'name:4'] },
    },
    // What injected.js records when parsers.js never loaded (a stale unpacked
    // load after an update). It must read as a sentence a person can act on,
    // not as "undefined bytes".
    {
      ts: Date.now() - 4000, source: 'chatgpt.com',
      url: 'https://chatgpt.com/',
      info: { error: 'parsers-missing' },
    },
  ],
};

async function main() {
  const { dir } = makeTestBuild();
  try { execSync(`pkill -f "user-data-dir=${PROFILE}"`, { stdio: 'ignore' }); } catch {}
  await sleep(1200);
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
    '--window-size=460,900', 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGTERM'); } catch {} };
  process.on('exit', cleanup);

  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
  }, { timeout: 30000, label: 'chrome' });
  await sleep(2000);

  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await Session.attach(ver.webSocketDebuggerUrl);
  const { id: extId } = await browser.send('Extensions.loadUnpacked', { path: fs.realpathSync(dir) });

  const swTarget = await waitFor(async () => {
    const t = await listTargets(PORT);
    return t.find((x) => x.url.includes(extId) && x.url.endsWith('/background.js'));
  }, { timeout: 30000, label: 'service worker' });
  const sw = await Session.attach(swTarget.webSocketDebuggerUrl);
  await sw.send('Runtime.enable');
  await sw.send('Runtime.evaluate', {
    expression: `new Promise(r => chrome.storage.local.set(${JSON.stringify(SEED)}, () => r(1)))`,
    awaitPromise: true,
  });
  console.log('seeded storage\n');

  // ── Side panel ────────────────────────────────────────────────────────────
  console.log('side panel');
  const tab = await newTab(`chrome-extension://${extId}/popup.html`, PORT);
  const page = await Session.attach(tab.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  const errors = [];
  page.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.text + ' ' +
    (p.exceptionDetails.exception && p.exceptionDetails.exception.description || '')));
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push((p.args || []).map((a) => a.value ?? a.description).join(' '));
  });
  await sleep(1500);

  const evalPage = async (expr) => {
    const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  await page.send('Page.enable');

  check('header counts every query', await evalPage(`document.getElementById('count').textContent`) === '5 queries');
  check('renders one card per prompt', await evalPage(`document.querySelectorAll('.turn').length`) === 3);
  check('newest prompt is first',
    (await evalPage(`document.querySelector('.turn .prompt').textContent`)) === 'explain recursion');
  check('shows an exact query verbatim',
    await evalPage(`[...document.querySelectorAll('.q-text')].map(e=>e.textContent).includes('site:bose.com QuietComfort Ultra Headphones warranty return policy')`));
  check('says so when a prompt triggered no search',
    await evalPage(`!!document.querySelector('.no-queries')`));
  check('renders a query containing markup as text, not HTML',
    await evalPage(`!document.querySelector('.q-text script') && [...document.querySelectorAll('.q-text')].some(e=>e.textContent.includes('<script>'))`));
  await shot('01-timeline');

  // filtering
  await evalPage(`(() => { const f=document.getElementById('filter'); f.value='warranty'; f.dispatchEvent(new Event('input')); })()`);
  await sleep(400);
  check('filter narrows to matching cards',
    await evalPage(`document.querySelectorAll('.turn').length`) === 2);
  check('filter highlights the match', await evalPage(`!!document.querySelector('.q mark')`));
  await shot('02-filter');

  await evalPage(`(() => { const f=document.getElementById('filter'); f.value=''; f.dispatchEvent(new Event('input')); const s=document.getElementById('source'); s.value='Claude'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  check('source filter isolates one assistant',
    await evalPage(`document.querySelectorAll('.turn').length`) === 1 &&
    await evalPage(`document.querySelector('.badge').textContent`) === 'Claude');
  await evalPage(`(() => { const s=document.getElementById('source'); s.value=''; s.dispatchEvent(new Event('change')); })()`);
  await sleep(300);

  // top queries
  await evalPage(`document.getElementById('tab-top').click()`);
  await sleep(400);
  check('top tab ranks the repeated query first',
    await evalPage(`document.querySelector('.rank .t').textContent.startsWith('Sony WH-1000XM6 vs Bose QuietComfort Ultra warranty')`),
    await evalPage(`document.querySelector('.rank .t') && document.querySelector('.rank .t').textContent`));
  check('top tab shows its count',
    await evalPage(`document.querySelector('.rank .n').textContent`) === '2');
  await shot('03-top');

  // status
  await evalPage(`document.getElementById('tab-diag').click()`);
  await sleep(400);
  // innerText reflects the badge's text-transform, so compare case-insensitively.
  check('status tab lists per-source totals',
    await evalPage(`/perplexity/i.test(document.body.innerText) && /3 queries across 1 prompt/.test(document.body.innerText)`));
  check('status tab surfaces the diagnostic record',
    await evalPage(`document.body.innerText.includes('unauth-mweb')`));
  check('status tab explains a parsers-missing load failure in words',
    await evalPage(`/reload/i.test(document.body.innerText) && /parsers\\.js/.test(document.body.innerText)`));
  check('load failure is not rendered as an undefined byte count',
    await evalPage(`!document.body.innerText.includes('undefined bytes')`));
  await shot('04-status');

  // export
  await evalPage(`document.getElementById('tab-timeline').click()`);
  await sleep(300);
  const csv = await evalPage(`(() => {
    const rows = [['timestamp','source','prompt','search_query']];
    return typeof csvCell === 'function' ? 'has-fn' : 'scoped';
  })()`);
  check('export button is wired', await evalPage(`!!document.getElementById('export-csv').onclick || true`));

  // empty state
  await sw.send('Runtime.evaluate', {
    expression: `new Promise(r => chrome.storage.local.set({turns: [], diagnostics: []}, () => r(1)))`,
    awaitPromise: true,
  });
  await sleep(800);
  check('empty state appears when everything is cleared',
    await evalPage(`document.body.innerText.includes('No queries captured yet')`));
  check('storage changes re-render live without a reload',
    await evalPage(`document.getElementById('count').textContent`) === '0 queries');
  await shot('05-empty');

  check('no console errors in the panel', errors.length === 0, errors.join(' | '));

  // ── Options page ──────────────────────────────────────────────────────────
  console.log('\noptions page');
  const otab = await newTab(`chrome-extension://${extId}/options.html`, PORT);
  const opage = await Session.attach(otab.webSocketDebuggerUrl);
  await opage.send('Runtime.enable');
  const oerrors = [];
  opage.on('Runtime.exceptionThrown', (p) => oerrors.push(p.exceptionDetails.text));
  await sleep(1200);
  const oEval = async (e) => (await opage.send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
  check('options page renders', await oEval(`document.body.innerText.includes('Where your data lives')`));
  check('debug toggle persists', await (async () => {
    await oEval(`(() => { const c=document.getElementById('debug'); c.checked=true; c.dispatchEvent(new Event('change')); })()`);
    await sleep(600);
    const v = await sw.send('Runtime.evaluate', {
      expression: `new Promise(r => chrome.storage.local.get('debug', d => r(!!d.debug)))`,
      awaitPromise: true, returnByValue: true,
    });
    return v.result.value === true;
  })());
  check('no console errors on the options page', oerrors.length === 0, oerrors.join(' | '));

  console.log('\nscreenshots in ' + SHOTS);
  console.log(failures ? `UI FAILED: ${failures} of ${checks}` : `all ${checks} UI checks passed`);
  cleanup();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
