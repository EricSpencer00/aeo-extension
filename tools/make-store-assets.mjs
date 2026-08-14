// Builds Chrome Web Store screenshots (1280x800) from a real capture: drives
// Perplexity live, screenshots the actual page and the actual side panel, and
// composes them. Nothing here is mocked up.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Session, listTargets, newTab, sleep, waitFor } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'store');
const PORT = 9666;
const PROFILE = '/tmp/aeo-assets-profile';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PROMPT = 'compare the warranty and battery life of the Sony WH-1000XM6 and the Bose QuietComfort Ultra, and which retailer is cheapest right now';

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  try { execSync(`pkill -f "user-data-dir=${PROFILE}"`, { stdio: 'ignore' }); } catch {}
  await sleep(1200);
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGTERM'); } catch {} };
  process.on('exit', cleanup);

  await waitFor(async () => {
    try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; }
  }, { timeout: 30000, label: 'chrome' });
  await sleep(2000);

  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await Session.attach(ver.webSocketDebuggerUrl);
  const { id: extId } = await browser.send('Extensions.loadUnpacked', { path: fs.realpathSync(ROOT) });
  const swTarget = await waitFor(async () => {
    const t = await listTargets(PORT);
    return t.find((x) => x.url.includes(extId) && x.url.endsWith('/background.js'));
  }, { timeout: 30000, label: 'service worker' });
  const sw = await Session.attach(swTarget.webSocketDebuggerUrl);
  await sw.send('Runtime.enable');
  const swEval = async (e) => (await sw.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  await swEval('new Promise(r => chrome.storage.local.clear(() => r(1)))');

  // ── Drive a real Perplexity answer ───────────────────────────────────────
  console.log('running a live query on Perplexity…');
  const tab = await newTab('https://www.perplexity.ai/', PORT);
  const page = await Session.attach(tab.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await sleep(8000);

  // Perplexity throws up a cookie banner and a sign-in modal that would
  // otherwise sit in the middle of the store screenshot.
  const dismissOverlays = async () => {
    await page.send('Runtime.evaluate', {
      expression: `(() => {
        let n = 0;
        for (const b of document.querySelectorAll('button')) {
          const t = (b.textContent || '').trim();
          const label = b.getAttribute('aria-label') || '';
          if (/^(got it|accept|allow all|decline optional)$/i.test(t) || /close|dismiss/i.test(label)) {
            b.click(); n++;
          }
        }
        return n;
      })()`,
      returnByValue: true,
    });
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
    await sleep(500);
  };
  await dismissOverlays();

  const readTurns = async () =>
    JSON.parse(await swEval(`new Promise(r => chrome.storage.local.get('turns', d => r(JSON.stringify(d.turns || []))))`));
  const bestTurn = async () =>
    (await readTurns()).reduce((best, t) => (t.queries.length > (best ? best.queries.length : 0) ? t : best), null);

  const ask = async (prompt, marker) => {
    const focused = await page.send('Runtime.evaluate', {
      expression: `(() => { for (const el of document.querySelectorAll('div[contenteditable="true"], textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width > 80 && r.height > 10 && el.offsetParent !== null) { el.focus(); el.click(); return true; }
      } return false; })()`,
      returnByValue: true,
    });
    if (!focused.result.value) throw new Error('composer not found on perplexity.ai');
    await sleep(800);
    await page.send('Input.insertText', { text: prompt });
    await sleep(1200);
    const typed = await page.send('Runtime.evaluate', {
      expression: `document.body.innerText.includes(${JSON.stringify(marker)})`, returnByValue: true,
    });
    if (!typed.result.value) throw new Error('prompt text did not land in the composer');
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', {
        type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        text: type === 'keyDown' ? '\r' : undefined,
      });
    }
    // How many searches Perplexity runs varies per session, so settle on a
    // stable count rather than waiting for a fixed one.
    let last = -1;
    for (let stable = 0, waited = 0; stable < 3 && waited < 140000; waited += 4000) {
      await sleep(4000);
      const t = await bestTurn();
      const n = t ? t.queries.length : 0;
      stable = n === last && n > 0 ? stable + 1 : 0;
      last = n;
    }
    return last;
  };

  // A single search makes a poor screenshot, and anonymous sessions sometimes
  // answer without decomposing. Retry with a harder prompt until it does.
  const ATTEMPTS = [
    [PROMPT, 'WH-1000XM6'],
    ['which is better for a home office in 2026, the Herman Miller Aeron or the Steelcase Leap, comparing warranty length, adjustability, and current street price', 'Herman Miller'],
    ['compare the 2026 pricing, free tier limits, and SOC 2 status of Vercel, Netlify and Cloudflare Pages', 'Cloudflare Pages'],
  ];

  // Anonymous Perplexity puts up a full-page signup wall after a couple of
  // answers, so each attempt is photographed the moment it settles rather than
  // at the end of the run.
  const shootSite = async () => {
    await sleep(5000);
    await dismissOverlays();
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 880, height: 800, deviceScaleFactor: 2, mobile: false,
    });
    await sleep(2500);
    await page.send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
    await sleep(800);
    const shot = (await page.send('Page.captureScreenshot', { format: 'png' })).data;
    await page.send('Emulation.clearDeviceMetricsOverride');
    await sleep(1000);
    return shot;
  };

  // The signup wall is driven by the anonymous search counter in cookies.
  // Clearing cookies and captured queries between attempts means every attempt
  // is a first-time visit, so the page stays clean and the panel ends up
  // showing exactly the one prompt that is being demonstrated.
  await page.send('Network.enable');
  const resetSession = async () => {
    await page.send('Network.clearBrowserCookies');
    await swEval('new Promise(r => chrome.storage.local.clear(() => r(1)))');
    await page.send('Page.navigate', { url: 'https://www.perplexity.ai/' });
    await sleep(9000);
    await dismissOverlays();
  };

  let captured = 0;
  let siteShot = null;
  for (const [prompt, marker] of ATTEMPTS) {
    let n = 0;
    try {
      n = await ask(prompt, marker);
    } catch (e) {
      console.warn('  attempt failed:', e.message);
    }
    console.log('  attempt captured', n, 'queries');
    if (n >= 3) { captured = n; siteShot = await shootSite(); break; }
    if (n > captured) { captured = n; siteShot = await shootSite(); }
    await resetSession();
  }
  if (!captured || !siteShot) {
    const s = (await page.send('Page.captureScreenshot', { format: 'png' })).data;
    fs.writeFileSync('/tmp/aeo-assets-failure.png', Buffer.from(s, 'base64'));
    throw new Error('no queries captured; page state in /tmp/aeo-assets-failure.png');
  }
  console.log(`captured ${captured} queries live in a single turn`);

  // ── Screenshot the real side panel in three states ───────────────────────
  const panelShot = async (setup) => {
    const t = await newTab(`chrome-extension://${extId}/popup.html`, PORT);
    const p = await Session.attach(t.webSocketDebuggerUrl);
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(1200);
    if (setup) { await p.send('Runtime.evaluate', { expression: setup, returnByValue: true }); await sleep(600); }
    const data = (await p.send('Page.captureScreenshot', { format: 'png' })).data;
    p.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
    return data;
  };

  const shots = {
    timeline: await panelShot(null),
    top: await panelShot(`document.getElementById('tab-top').click()`),
    status: await panelShot(`document.getElementById('tab-diag').click()`),
  };

  // ── Compose 1280x800 ─────────────────────────────────────────────────────
  const compose = async (name, headline, sub, panelData, showSite, bullets) => {
    const html = `<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{width:1280px;height:800px;overflow:hidden;
        background:radial-gradient(1200px 700px at 78% -10%, #1d3350 0%, #0e1116 62%);
        font:16px/1.5 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6edf3;
        display:flex;flex-direction:column;padding:38px 44px}
      h1{font-size:34px;letter-spacing:-.022em;font-weight:680;margin-bottom:8px}
      h1 em{font-style:normal;color:#4ea3ff}
      p.sub{font-size:16px;color:#93a1b4;margin-bottom:24px;max-width:900px}
      .stage{flex:1;display:flex;gap:26px;align-items:flex-start;min-height:0}
      .browser{flex:1;min-width:0;height:100%;border-radius:12px;overflow:hidden;
        border:1px solid #2b3442;background:#0c0f14;box-shadow:0 24px 60px rgba(0,0,0,.5)}
      .chrome{height:30px;background:#1b2129;display:flex;align-items:center;gap:6px;padding:0 12px;
        border-bottom:1px solid #2b3442}
      .dot{width:9px;height:9px;border-radius:50%}
      .bar{flex:1;height:16px;border-radius:8px;background:#0e1319;margin-left:8px}
      .browser img{width:100%;display:block}
      .panel{width:400px;flex:none;height:100%;border-radius:12px;overflow:hidden;
        border:1px solid #2b3442;box-shadow:0 24px 60px rgba(0,0,0,.55)}
      .panel img{width:400px;display:block}
      .points{flex:1;min-width:0;padding:14px 30px 0 4px}
      .point{display:flex;gap:14px;margin-bottom:26px;align-items:flex-start}
      .point .mark{width:26px;height:26px;flex:none;border-radius:7px;background:#17324f;
        color:#4ea3ff;font-size:15px;font-weight:700;display:flex;align-items:center;
        justify-content:center;margin-top:2px}
      .point h3{font-size:19px;font-weight:620;margin-bottom:3px;letter-spacing:-.012em}
      .point p{font-size:15px;color:#93a1b4;line-height:1.45}
    </style>
    <h1>${headline}</h1><p class="sub">${sub}</p>
    <div class="stage">
      ${showSite ? `<div class="browser">
        <div class="chrome"><span class="dot" style="background:#ff5f57"></span>
        <span class="dot" style="background:#febc2e"></span>
        <span class="dot" style="background:#28c840"></span><span class="bar"></span></div>
        <img src="data:image/png;base64,${siteShot}">
      </div>` : ''}
      ${bullets ? `<div class="points">${bullets.map((b, i) => `
        <div class="point"><div class="mark">${i + 1}</div>
        <div><h3>${b[0]}</h3><p>${b[1]}</p></div></div>`).join('')}</div>` : ''}
      <div class="panel"><img src="data:image/png;base64,${panelData}"></div>
    </div>`;
    const file = path.join('/tmp', 'aeo-compose.html');
    fs.writeFileSync(file, html);
    const t = await newTab('file://' + file, PORT);
    const p = await Session.attach(t.webSocketDebuggerUrl);
    await p.send('Page.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(1600);
    const data = (await p.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    p.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {});
    console.log('  wrote store/' + name);
  };

  await compose('screenshot-1-timeline.png',
    'See the <em>exact</em> queries AI runs for you',
    `One prompt to Perplexity became ${captured} real search ${captured === 1 ? 'query' : 'queries'}. Those are the strings your content has to rank for.`,
    shots.timeline, true);
  await compose('screenshot-2-top.png',
    'Ranked by how often they come up',
    'Every query the assistants issued, counted and sorted. Export to CSV and hand it to whoever writes your content.',
    shots.top, true);
  await compose('screenshot-3-privacy.png',
    'Everything stays in your browser',
    'No account, no server, no analytics.',
    shots.timeline, false, [
      ['Nothing is uploaded', 'Captured prompts and queries are written to local extension storage on your own machine. The extension makes no network requests of its own.'],
      ['Only the AI sites', 'It runs on ChatGPT, Claude, Perplexity, Gemini and Copilot, and is inert on every other page. It never asks for access to all sites.'],
      ['Yours to delete', 'Clear it from the panel, wipe it from the options page, or uninstall. There is no copy anywhere else.'],
      ['Open source', 'MIT licensed, and every line that ships is in the repository.'],
    ]);

  console.log('\ndone — ' + OUT);
  cleanup();
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
