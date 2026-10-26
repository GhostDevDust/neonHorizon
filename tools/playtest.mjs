// Headless flat-screen playtest: boots the game, shoots NORMAL on the title
// screen, plays for a while with the mouse, and reports console errors, frame
// times and what the run looked like.
//
//   npm run start:http                 (in one terminal; or PORT=... to move it)
//   node tools/playtest.mjs            (in another)
//
//   NH_URL=http://localhost:8443/   page to load
//   NH_SECS=50                      seconds of play (the first sun rises at 40)
//   NH_IDLE=1                       never fire: play until the shields run out and
//                                   fail unless the score is still 0 (nothing but
//                                   a shot should ever pay)
//   NH_SHOTS=dir                    keep screenshots there (default tools/shots)
//   NH_CHROME=path                  browser to drive (default: installed Chrome)
//   GPU=1                           real GPU instead of SwiftShader
//
// puppeteer is not a dependency of this game: it is borrowed from Salvo's
// node_modules (or NH_PUPPETEER=path/to/puppeteer-core).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PUP = process.env.NH_PUPPETEER || path.join(here, '..', '..', 'salvo', 'node_modules', 'puppeteer-core');
const puppeteer = require(PUP);

const URL_ = process.env.NH_URL || 'http://localhost:8443/';
const SECS = Number(process.env.NH_SECS) || 50;
const IDLE = !!process.env.NH_IDLE;
const OUT = process.env.NH_SHOTS || path.join(here, 'shots');
const CHROME = process.env.NH_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--autoplay-policy=no-user-gesture-required',
    ...(process.env.GPU ? ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader']),
  ],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__NH, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(OUT, '0-title.png') });

const info = await page.evaluate(() => ({
  btn: document.getElementById('vrBtn').textContent,
  note: document.getElementById('note').textContent,
  phase: window.__NH.state.phase,
}));
console.log('title:', info);

// Frame timer, from the page's own rAF.
await page.evaluate(() => {
  const f = (window.__frames = []);
  let last = performance.now();
  const step = (t) => { f.push(t - last); last = t; requestAnimationFrame(step); };
  requestAnimationFrame(step);
});

// Aim at NORMAL (the middle button) and click: the first click may only grab
// the mouse, so click until the run starts.
await page.evaluate(() => { const { look } = window.__NH; look.yaw = 0; look.pitch = -0.07; });
for (let i = 0; i < 4; i++) {
  await page.mouse.click(640, 396);
  await new Promise((r) => setTimeout(r, 300));
  if (await page.evaluate(() => window.__NH.state.phase === 'playing')) break;
}
const started = await page.evaluate(() => ({ locked: !!document.pointerLockElement, phase: window.__NH.state.phase, mode: window.__NH.state.mode, lives: window.__NH.state.lives }));
console.log('after clicking NORMAL:', started);

// Play: every half second, turn to the nearest falling meteor and fire.
const t0 = Date.now();
let shot = 1;
while (Date.now() - t0 < SECS * 1000) {
  if (IDLE) {
    if (await page.evaluate(() => window.__NH.state.phase !== 'playing')) break;
    await new Promise((r) => setTimeout(r, 500));
    continue;
  }
  await page.evaluate(() => {
    const { targets, camera, look, THREE } = window.__NH;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    let best = null;
    for (const t of targets.active) {
      const d = t.obj.position.clone().sub(eye);
      if (!best || d.y < best.y) best = d;
    }
    if (!best) return;
    look.yaw = Math.atan2(-best.x, -best.z);
    look.pitch = Math.atan2(best.y, Math.hypot(best.x, best.z));
  });
  await page.mouse.down();
  await new Promise((r) => setTimeout(r, 80));
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 420));
  const s = (Date.now() - t0) / 1000;
  if (s > shot * 15) {
    await page.screenshot({ path: path.join(OUT, `${shot}-play-${Math.round(s)}s.png`) });
    shot++;
  }
}

const result = await page.evaluate(() => {
  const { state } = window.__NH;
  const f = window.__frames.slice(10).sort((a, b) => a - b);
  const pct = (p) => +f[Math.min(f.length - 1, Math.floor(f.length * p))].toFixed(1);
  return {
    phase: state.phase, elapsed: +state.elapsed.toFixed(1), lives: state.lives,
    score: state.books[state.me].score, combo: state.books[state.me].combo,
    frames: f.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), worst: pct(1),
  };
});
console.log('end of run:', result);
await page.screenshot({ path: path.join(OUT, `${shot}-end.png`) });

console.log(errors.length ? `console (${errors.length}):\n  ` + [...new Set(errors)].join('\n  ') : 'console: clean');
await browser.close();
const idleScored = IDLE && result.score !== 0;
if (idleScored) console.log(`FAIL: a run that never fired scored ${result.score}`);
process.exit(result.phase === 'idle' || idleScored || errors.some((e) => e.startsWith('pageerror')) ? 1 : 0);
