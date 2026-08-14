// Builds the Chrome Web Store upload zip from an explicit allow-list, so
// captures, fixtures and test tooling can never leak into a published package.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SHIP = [
  'manifest.json',
  'parsers.js',
  'injected.js',
  'content.js',
  'background.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'LICENSE',
  'images/icon-16.png',
  'images/icon-48.png',
  'images/icon-128.png',
];

const STAGE = '/tmp/aeo-package';
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const OUT = path.join(ROOT, `aeo-extension-v${manifest.version}.zip`);

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'images'), { recursive: true });

const missing = [];
for (const f of SHIP) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { missing.push(f); continue; }
  fs.copyFileSync(src, path.join(STAGE, f));
}
if (missing.length) {
  console.error('missing required files:', missing.join(', '));
  process.exit(1);
}

// Guard: the manifest must not reference anything that is not being shipped.
const referenced = new Set();
for (const cs of manifest.content_scripts || []) for (const j of cs.js || []) referenced.add(j);
for (const war of manifest.web_accessible_resources || []) for (const r of war.resources || []) referenced.add(r);
if (manifest.background && manifest.background.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.side_panel && manifest.side_panel.default_path) referenced.add(manifest.side_panel.default_path);
if (manifest.options_page) referenced.add(manifest.options_page);
for (const icon of Object.values(manifest.icons || {})) referenced.add(icon);

const notShipped = [...referenced].filter((r) => !SHIP.includes(r));
if (notShipped.length) {
  console.error('manifest references files that are not packaged:', notShipped.join(', '));
  process.exit(1);
}

// Guard: no localhost permissions in a published build.
const perms = JSON.stringify([manifest.host_permissions, manifest.content_scripts]);
if (/localhost|127\.0\.0\.1|<all_urls>/.test(perms)) {
  console.error('refusing to package: manifest grants localhost or all-urls access');
  process.exit(1);
}

fs.rmSync(OUT, { force: true });
execFileSync('zip', ['-r', '-X', OUT, '.'], { cwd: STAGE, stdio: 'ignore' });

const size = fs.statSync(OUT).size;
console.log(`packaged ${SHIP.length} files → ${path.basename(OUT)} (${(size / 1024).toFixed(1)} KB)`);
console.log('contents:');
for (const f of SHIP) console.log('  ' + f);
