// End-to-end test: loads the real extension into a real Chrome, replays real
// AI streams at it from localhost, and asserts on what actually landed in
// chrome.storage.local. Exercises the whole chain — page fetch → injected.js
// tap → content.js bridge → service worker → storage.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Session, listTargets, newTab, sleep, waitFor } from './cdp.mjs';
import { makeTestBuild } from './make-test-build.mjs';
import { startServer } from './replay-server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 9333;
const HTTP_PORT = 8899;
const PROFILE = '/tmp/aeo-e2e-profile';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Chrome derives an unpacked extension's id from its absolute path.
function extensionIdForPath(p) {
  const hash = crypto.createHash('sha256').update(p).digest('hex').slice(0, 32);
  return [...hash].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

async function main() {
  console.log('building test extension…');
  const { dir } = makeTestBuild();
  console.log('  dir', dir);

  // A Chrome still holding the profile lock silently swallows --load-extension.
  try { execSync(`pkill -f "user-data-dir=${PROFILE}"`, { stdio: 'ignore' }); } catch {}
  await sleep(1500);

  const server = await startServer(HTTP_PORT);
  console.log('replay server on', HTTP_PORT);

  fs.rmSync(PROFILE, { recursive: true, force: true });
  // --load-extension installs the extension but leaves its MV3 worker dormant
  // on a fresh profile, so it is not a debug target. Extensions.loadUnpacked
  // installs it *and* hands back the id with the worker running.
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  const cleanup = () => {
    try { chrome.kill('SIGTERM'); } catch {}
    try { server.close(); } catch {}
  };
  process.on('exit', cleanup);

  await waitFor(async () => {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); return r.ok; }
    catch { return false; }
  }, { timeout: 30000, label: 'chrome debug port' });
  await sleep(2500);

  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await Session.attach(ver.webSocketDebuggerUrl);
  const loaded = await browser.send('Extensions.loadUnpacked', { path: fs.realpathSync(dir) });
  const extId = loaded.id;
  console.log('  loaded extension', extId);

  // ── Find the extension's service worker ──────────────────────────────────
  const swTarget = await waitFor(async () => {
    const targets = await listTargets(PORT);
    return targets.find((t) =>
      (t.type === 'service_worker' || t.type === 'worker') && t.url.includes(extId));
  }, { timeout: 30000, label: 'extension service worker' });
  console.log('  service worker:', swTarget.url);

  const sw = await Session.attach(swTarget.webSocketDebuggerUrl);
  await sw.send('Runtime.enable');

  const swEval = async (expr) => {
    const r = await sw.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception || {}));
    return r.result.value;
  };

  const readTurns = () => swEval(`new Promise(r => chrome.storage.local.get('turns', d => r(JSON.stringify(d.turns || []))))`).then(JSON.parse);
  const readDiagnostics = () => swEval(`new Promise(r => chrome.storage.local.get('diagnostics', d => r(JSON.stringify(d.diagnostics || []))))`).then(JSON.parse);
  const clearAll = () => swEval(`new Promise(r => chrome.storage.local.clear(() => r(1)))`);

  check('service worker is alive', await swEval('1 + 1') === 2);

  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/perplexity-multistep.json'), 'utf8'));

  const scenarios = [
    {
      name: 'Perplexity (real captured stream)',
      scenario: 'Perplexity',
      source: 'Perplexity',
      prompt: fixture.expectedPrompt,
      expect: fixture.expectedQueries,
      exact: true,
    },
    {
      name: 'Perplexity with the page aborting mid-stream',
      scenario: 'PerplexityAbort',
      source: 'Perplexity',
      prompt: fixture.expectedPrompt,
      expect: fixture.expectedQueries.slice(0, 3),
      exact: false,
    },
    {
      name: 'Claude (claude.ai frontend shape)',
      scenario: 'Claude',
      source: 'Claude',
      prompt: 'what should I rank for in AI answers?',
      expect: ['chrome extension manifest v3 side panel best practices', 'chrome web store review time 2026'],
      exact: true,
    },
    {
      name: 'Claude (streamed input_json_delta tool args)',
      scenario: 'ClaudeApi',
      source: 'Claude',
      prompt: 'best headphones for flights',
      expect: ['best noise cancelling headphones for travel 2026', 'Sony WH-1000XM6 review battery life'],
      exact: true,
    },
    {
      name: 'ChatGPT (web.run + search_model_queries)',
      scenario: 'ChatGPT',
      source: 'ChatGPT',
      prompt: 'best noise cancelling headphones for travel 2026',
      expect: [
        'best noise cancelling headphones travel 2026',
        'quietest ANC headphones long haul flight review',
        'top rated ANC over-ear headphones flights',
        'noise cancelling headphones best for airplanes',
      ],
      exact: true,
    },
  ];

  for (const sc of scenarios) {
    console.log('\n' + sc.name);
    await clearAll();
    const t = await newTab(`http://localhost:${HTTP_PORT}/?scenario=${sc.scenario}`, PORT);
    const page = await Session.attach(t.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    try {
      await waitFor(async () => {
        const r = await page.send('Runtime.evaluate', { expression: 'window.__aeoReplayDone === true', returnByValue: true });
        return r.result.value;
      }, { timeout: 60000, interval: 400, label: 'replay to finish' });
    } catch (e) {
      check('replay finished', false, e.message);
    }
    const pageState = await page.send('Runtime.evaluate', {
      expression: 'JSON.stringify({chars: window.__aeoReplayChars, aborted: !!window.__aeoReplayAborted, text: document.getElementById("out").textContent})',
      returnByValue: true,
    });
    console.log('    page:', pageState.result.value);

    await sleep(1500); // let the last messages reach storage
    const turns = await readTurns();
    const mine = turns.filter((x) => x.source === sc.source);
    const got = mine.flatMap((x) => x.queries.map((q) => q.q));

    check('a turn was recorded', mine.length >= 1, 'turns=' + JSON.stringify(turns.map((t) => t.source)));
    check('the human prompt was captured',
      mine.some((x) => x.prompt === sc.prompt),
      'expected ' + JSON.stringify(sc.prompt) + ' got ' + JSON.stringify(mine.map((x) => x.prompt)));

    const missing = sc.expect.filter((q) => !got.includes(q));
    check(`captured ${sc.expect.length} expected quer${sc.expect.length === 1 ? 'y' : 'ies'}`,
      missing.length === 0, 'missing ' + JSON.stringify(missing) + '\n      got ' + JSON.stringify(got));

    if (sc.exact) {
      const extra = got.filter((q) => !sc.expect.includes(q));
      check('no spurious queries', extra.length === 0, 'extra ' + JSON.stringify(extra));
    }

    // Page integrity: the site must receive its bytes unchanged.
    const chars = JSON.parse(pageState.result.value).chars;
    check('page still received the stream', chars > 500, 'chars=' + chars);

    page.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
  }

  // ── Diagnostics on an unrecognised protocol ──────────────────────────────
  console.log('\ndiagnostics');
  const diags = await readDiagnostics();
  check('no diagnostics recorded when capture succeeds', diags.length === 0,
    JSON.stringify(diags.map((d) => d.source + ' ' + d.url)));

  console.log('\n' + (failures ? `E2E FAILED: ${failures} of ${checks}` : `all ${checks} end-to-end checks passed`));
  cleanup();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
