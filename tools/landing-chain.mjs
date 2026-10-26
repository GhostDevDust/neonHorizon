// Headless check that only a shot pays for a cascade. Starts a NORMAL run, holds
// the spawner, then stages two meteors side by side twice over:
//
//   landing  one touches the ground beside the other. Its burst should still
//            take the neighbour out, and the score should not move.
//   shot     the same pair, but the first is killed by our own shot. The
//            neighbour's chain kill should pay blastPoints.
//
//   npm run start:http                 (in one terminal)
//   node tools/landing-chain.mjs       (in another)
//
//   NH_URL=http://localhost:8443/   page to load; add ?classic for the old rules
//   NH_CHROME=path                  browser to drive (default: installed Chrome)
//
// puppeteer is borrowed from Salvo's node_modules, as in playtest.mjs.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PUP = process.env.NH_PUPPETEER || path.join(here, '..', '..', 'salvo', 'node_modules', 'puppeteer-core');
const puppeteer = require(PUP);

const URL_ = process.env.NH_URL || 'http://localhost:8443/';
const CHROME = process.env.NH_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const classic = /[?&]classic\b/.test(URL_);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__NH, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

await page.evaluate(() => { const { look } = window.__NH; look.yaw = 0; look.pitch = -0.07; });
for (let i = 0; i < 4; i++) {
  await page.mouse.click(640, 396);
  await new Promise((r) => setTimeout(r, 300));
  if (await page.evaluate(() => window.__NH.state.phase === 'playing')) break;
}

// Stage the pair: A at (x, y, -3), B 0.6m beside it and hanging in the air.
// Returns the score before and after, and whether B is still in the field.
async function stage(name, shoot) {
  const r = await page.evaluate(async (shoot) => {
    const { targets, state, THREE } = window.__NH;
    targets.spawnTimer = 1e9;
    targets.clear();
    const before = state.books[state.me].score;
    const a = targets.spawnAt(0, new THREE.Vector3(3, shoot ? 3 : 0.5, -3), new THREE.Vector3(0, shoot ? 0 : -3, 0));
    const b = targets.spawnAt(0, new THREE.Vector3(3.6, shoot ? 3.2 : 0.9, -3), new THREE.Vector3(0, -0.01, 0));
    if (shoot) targets.destroy(a, state.me);
    await new Promise((res) => setTimeout(res, 1200));
    return {
      before, after: state.books[state.me].score, phase: state.phase,
      aGone: !targets.active.includes(a), bGone: !targets.active.includes(b),
    };
  }, shoot);
  console.log(`${name}:`, r);
  return r;
}

const land = await stage('landing', false);
const shot = await stage('shot', true);
await browser.close();

const fails = [];
if (!land.aGone || !land.bGone) fails.push('landing burst should still take out its neighbour');
if (classic ? land.after === land.before : land.after !== land.before) {
  fails.push(classic ? '?classic should keep the old rule (landing chains pay)' : 'a landing chain paid points');
}
if (!shot.bGone || shot.after <= shot.before) fails.push('a shot-started chain should still pay');
if (errors.length) fails.push('page errors: ' + errors.join('; '));
console.log(fails.length ? 'FAIL\n  ' + fails.join('\n  ') : 'ok');
process.exit(fails.length ? 1 : 0);
