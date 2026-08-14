// Drive a real Chrome tab over CDP, record all traffic, dump it to JSON.
//
//   node tools/capture.mjs --url https://www.perplexity.ai/ --out /tmp/pplx.json \
//        --prompt "best running shoes for flat feet 2026" --wait 60
//
// Requires Chrome started with --remote-debugging-port=9222 (see tools/launch-chrome.sh).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, listTargets, newTab, sleep, waitFor } from './cdp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDER = fs.readFileSync(path.join(__dirname, 'recorder.js'), 'utf8');

function args() {
  const a = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
      o[k] = v;
    }
  }
  return o;
}

// Composer selectors per site, tried in order.
const COMPOSERS = [
  'div[contenteditable="true"]',
  'textarea[placeholder]',
  'textarea',
  'input[type="search"]',
  'input[type="text"]',
];

export async function attachToUrl(urlPart, { port = 9222, create = null } = {}) {
  let targets = await listTargets(port);
  let t = targets.find((x) => x.type === 'page' && x.url.includes(urlPart));
  if (!t && create) {
    t = await newTab(create, port);
    await sleep(1500);
  }
  if (!t) throw new Error(`no page target matching ${urlPart}`);
  const s = await Session.attach(t.webSocketDebuggerUrl);
  return { session: s, target: t };
}

async function main() {
  const o = args();
  const port = Number(o.port || 9222);
  const url = o.url;
  const out = o.out || '/tmp/aeo-capture.json';
  const waitSec = Number(o.wait || 45);

  const target = await newTab(url, port);
  const s = await Session.attach(target.webSocketDebuggerUrl);

  s.on('Runtime.consoleAPICalled', (p) => {
    const txt = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (txt.includes('[AEO')) console.log('  console>', txt.slice(0, 200));
  });

  await s.send('Runtime.enable');
  await s.send('Page.enable');
  await s.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
  await s.send('Page.reload', { ignoreCache: false });
  await sleep(6000);

  const ready = await s.send('Runtime.evaluate', {
    expression: '!!window.__aeoRec',
    returnByValue: true,
  });
  console.log('recorder installed:', ready.result.value);

  if (o.prompt) {
    console.log('typing prompt:', o.prompt);
    const focused = await s.send('Runtime.evaluate', {
      expression: `(() => {
        const sels = ${JSON.stringify(COMPOSERS)};
        for (const sel of sels) {
          for (const el of document.querySelectorAll(sel)) {
            const r = el.getBoundingClientRect();
            if (r.width > 80 && r.height > 10 && !el.disabled && el.offsetParent !== null) {
              el.focus(); el.click();
              return sel + ' @' + Math.round(r.x) + ',' + Math.round(r.y);
            }
          }
        }
        return null;
      })()`,
      returnByValue: true,
    });
    console.log('composer:', focused.result.value);
    if (!focused.result.value) console.warn('!! no composer found');

    await sleep(600);
    await s.send('Input.insertText', { text: String(o.prompt) });
    await sleep(900);
    for (const type of ['keyDown', 'keyUp']) {
      await s.send('Input.dispatchKeyEvent', {
        type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
        text: type === 'keyDown' ? '\r' : undefined,
      });
    }
  }

  console.log(`waiting ${waitSec}s for the answer to stream...`);
  for (let i = 0; i < waitSec; i += 5) {
    await sleep(5000);
    const n = await s.send('Runtime.evaluate', {
      expression: 'window.__aeoRec ? window.__aeoRec.entries.length : -1',
      returnByValue: true,
    });
    process.stdout.write(`  t+${i + 5}s entries=${n.result.value}\r`);
  }
  console.log('');

  const dump = await s.send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__aeoRec ? window.__aeoRec.entries : [])',
    returnByValue: true,
    awaitPromise: false,
  });
  const entries = JSON.parse(dump.result.value || '[]');
  fs.writeFileSync(out, JSON.stringify({ url, pageUrl: target.url, entries }, null, 1));
  console.log(`wrote ${entries.length} entries -> ${out}`);

  const bytes = entries.reduce((a, e) => a + (e.resBody?.length || 0), 0);
  console.log('total captured response bytes:', bytes);
  for (const e of entries) {
    if ((e.reqBody && e.reqBody.length > 20) || (e.resBody && e.resBody.length > 400)) {
      console.log(` ${e.kind} ${e.method} ${e.url.slice(0, 110)} req=${e.reqBody?.length || 0} res=${e.resBody?.length || 0}`);
    }
  }
  s.close();
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
