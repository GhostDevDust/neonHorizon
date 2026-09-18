// Package the game for itch.io: `npm run itch`.
//
// itch wants a zip with index.html at its root, and serves it as static files on
// a Linux host. So: only what the browser loads (no server, no node_modules, no
// dev pages), and forward-slash paths in the zip -- PowerShell 5's
// Compress-Archive writes backslashes, which itch cannot unpack into folders.
// Windows' built-in tar (bsdtar) writes a proper zip.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist', 'itch');
const ZIP = path.join(ROOT, 'dist', 'neon-horizon-itch.zip');
const SHIP = ['index.html', 'src', 'vendor/three.module.js'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });

for (const entry of SHIP) {
  const from = path.join(ROOT, entry);
  const to = path.join(OUT, entry);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

// Every relative import has to resolve with exact case: itch's host is
// case-sensitive, Windows is not, so a mismatch works here and breaks there.
const missing = [];
for (const file of fs.readdirSync(path.join(OUT, 'src'))) {
  const text = fs.readFileSync(path.join(OUT, 'src', file), 'utf8');
  for (const [, spec] of text.matchAll(/from\s+'(\.[^']+)'/g)) {
    const target = path.join(OUT, 'src', spec);
    const dir = path.dirname(target);
    if (!fs.existsSync(dir) || !fs.readdirSync(dir).includes(path.basename(target))) {
      missing.push(`${file} -> ${spec}`);
    }
  }
}
if (missing.length) {
  console.error('Imports that will not resolve on itch:\n  ' + missing.join('\n  '));
  process.exit(1);
}

// Windows' own tar, by full path: Git Bash puts GNU tar first on PATH, and GNU tar
// cannot write zips and reads "C:" as a remote host.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || String.raw`C:\Windows`, 'System32', 'tar.exe') : 'tar';
execFileSync(TAR, ['-a', '-c', '-f', '../neon-horizon-itch.zip', ...new Set(SHIP.map((e) => e.split('/')[0]))], { cwd: OUT, stdio: 'inherit' });

const kb = Math.round(fs.statSync(ZIP).size / 1024);
console.log(`Built ${path.relative(ROOT, ZIP)} (${kb} KB) -- upload this to itch.`);
