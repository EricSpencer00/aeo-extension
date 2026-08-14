// Produces a test build of the extension: byte-identical JS/HTML, with the
// manifest widened to include the localhost replay server. Verifying that only
// manifest.json differs keeps the end-to-end test honest — the code under test
// is exactly the code that ships.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
export const BUILD_DIR = '/tmp/aeo-test-build';

const FILES = [
  'parsers.js', 'injected.js', 'content.js', 'background.js',
  'popup.html', 'popup.js', 'options.html', 'options.js',
];

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);

export function makeTestBuild() {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(BUILD_DIR, 'images'), { recursive: true });

  const hashes = {};
  for (const f of FILES) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) continue;
    const buf = fs.readFileSync(src);
    fs.writeFileSync(path.join(BUILD_DIR, f), buf);
    hashes[f] = sha(buf);
    const copied = fs.readFileSync(path.join(BUILD_DIR, f));
    if (!buf.equals(copied)) throw new Error('copy mismatch for ' + f);
  }
  for (const img of fs.readdirSync(path.join(ROOT, 'images'))) {
    fs.copyFileSync(path.join(ROOT, 'images', img), path.join(BUILD_DIR, 'images', img));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const LOCAL = 'http://localhost/*';
  manifest.host_permissions = [...manifest.host_permissions, LOCAL];
  for (const cs of manifest.content_scripts) cs.matches = [...cs.matches, LOCAL];
  for (const war of manifest.web_accessible_resources || []) war.matches = [...war.matches, LOCAL];
  manifest.name = manifest.name + ' (test build)';
  fs.writeFileSync(path.join(BUILD_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return { dir: BUILD_DIR, hashes };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { dir, hashes } = makeTestBuild();
  console.log('test build at', dir);
  for (const [f, h] of Object.entries(hashes)) console.log('  ', h, f);
}
