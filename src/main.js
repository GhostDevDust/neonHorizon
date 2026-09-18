import * as THREE from '../vendor/three.module.js';
import { PALETTE, CFG, MODES, fallSpeedAt } from './config.js';
import { buildScenery } from './scenery.js';
import { TargetField, KINDS } from './targets.js';
import { Blasters, pickTarget, ORB_RADIUS, WEAPONS, BOLT_SPEED } from './weapons.js';
import { Pad } from './gamepad.js';
import { HUD } from './hud.js';
import { OffscreenCues } from './offscreen.js';
import * as Audio from './audio.js';
import { Net } from './net.js';
import { SunBoss } from './boss.js';
import { makeSupernova } from './supernova.js';
import { Ghosts } from './ghosts.js';

const HEX = (n) => '#' + n.toString(16).padStart(6, '0');

// Flags, per window, from the query string. Read before anything else, because
// the scene objects below bake some of these in when they are constructed.
//   ?classic      the build as it stood at the start of this session
//   ?god          shields never run out
//   ?lives=N      start with N shields, whatever the mode says
const params = new URLSearchParams(location.search);
if (params.has('classic')) CFG.classic = true;
if (params.has('god')) CFG.infiniteLives = true;
const livesOverride = params.has('lives') ? Math.max(1, parseInt(params.get('lives'), 10) || CFG.lives) : 0;
if (livesOverride) CFG.lives = livesOverride;

// Shields for a mode. ?classic predates modes and keeps its five.
function applyMode(mode) {
  state.mode = MODES[mode] ? mode : null;
  if (state.mode && !CFG.classic) CFG.lives = livesOverride || MODES[mode].lives;
}

// ------------------------------------------------------------------ setup
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// Keep the Quest at a comfortable framerate rather than max resolution.
renderer.xr.setFramebufferScaleFactor(1.0);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.skyMid, 140, 480);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 1.6, 0);

const scenery = buildScenery(scene);
const targets = new TargetField(scene);
const hud = new HUD(scene);
const cues = new OffscreenCues(document.getElementById('cues'));

// The sun boss. Its hooks are the parts that belong to the game rather than the
// boss: sound, controller rumble, and the explosion over its disc.
// Everything that can shake the flat-screen camera. Never used in VR, where
// moving the view without the player moving their head is a nausea machine.
let shake = 0;

function rumbleAll(strength, ms) {
  pad.rumble(strength, ms);
  for (const h of blasters.hands) {
    const g = h.inputSource && h.inputSource.gamepad;
    const act = g && g.hapticActuators && g.hapticActuators[0];
    if (act) act.pulse(Math.min(1, strength), ms);
  }
}

const nova = makeSupernova(scene, camera);
// One small nova per shard -- no black hole, and a shockwave that stops well
// short of the players.
const shardNovas = [0, 1, 2].map(() => makeSupernova(scene, camera, { hole: false, shockReach: 30 }));
const boss = new SunBoss(scenery, targets, {
  rise() {
    Audio.sfxOmen(CFG.bossRise);
    // A gentle vibration that builds while it climbs. Felt through the Quest
    // controllers and the Xbox pad alike, and it works with your back turned.
    const steps = Math.round(CFG.bossRise / 0.25);
    let n = 0;
    const beat = setInterval(() => {
      const strength = 0.1 + 0.45 * (n / steps);
      pad.rumble(strength, 230);
      for (const h of blasters.hands) {
        const g = h.inputSource && h.inputSource.gamepad;
        const act = g && g.hapticActuators && g.hapticActuators[0];
        if (act) act.pulse(strength, 230);
      }
      if (++n >= steps) clearInterval(beat);
    }, 250);
  },
  // The gasp: it starts to fall in on itself.
  collapse() {
    Audio.sfxCollapse();
    rumbleAll(0.35, 500);
  },
  // The blast.
  nova(pos, killer) {
    Audio.sfxSunDeath();
    rumbleAll(1, 700);
    if (!renderer.xr.isPresenting) shake = 1;
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        const p = pos.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 2
        ));
        targets.explosions.burst(p, null, null);
      }, i * 60);
    }
    // The shockwave takes every one of the sun's meteors with it, and the
    // player who killed the sun is paid for them. Host only -- clients see
    // them go in the next snapshot.
    if (net.soloOrHost) {
      for (const t of [...targets.active]) {
        if (KINDS[t.kind].name !== 'ember' && KINDS[t.kind].name !== 'flare') continue;
        targets.destroy(t, killer);
        score(killer != null ? killer : state.me, CFG.blastPoints);
      }
      hud.drawScore(state);
    }
  },
  // Something is about to happen in the sky: shards trembling into pulsars, or
  // the nebula waking up. A building rumble, felt before it is seen.
  omen() {
    Audio.sfxOmen(2.6);
    const steps = 10;
    let n = 0;
    const beat = setInterval(() => {
      rumbleAll(0.1 + 0.4 * (n / steps), 230);
      if (++n >= steps) clearInterval(beat);
    }, 250);
  },
  // The nebula collapsing into a new star.
  birth() {
    Audio.sfxCollapse();
    setTimeout(() => Audio.sfxSunDeath(), 900);
    rumbleAll(0.8, 900);
  },
  // A pulsar going up: a smaller version of the sun's own death.
  shardNova(pos) {
    Audio.sfxExplode(0.45);
    setTimeout(() => Audio.sfxExplode(0.35), 110);
    rumbleAll(0.7, 350);
    if (!renderer.xr.isPresenting) shake = Math.max(shake, 0.5);
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 1));
        targets.explosions.burst(p, null, null);
      }, i * 70);
    }
  },
}, nova, shardNovas, { scene, camera });

// ------------------------------------------------------------ game state
const state = {
  phase: 'idle', // idle | playing | over
  lives: CFG.lives,
  // Every player's books, keyed by peer id. Scores and combos are separate;
  // shields are shared. One table rather than a "me" and a "them" slot, because
  // two slots silently break the moment a third tab joins, and someone at a
  // party always opens a third tab.
  books: { 0: { score: 0, combo: 1 } },
  me: 0,         // our own peer id; 0 until the relay assigns one
  mode: null,    // 'endless' | 'normal' | 'hardcore' -- see MODES in config.js
  coop: false,   // true once someone else is actually connected
  paused: false, // host is away -- see the visibilitychange handler
  elapsed: 0,
  tier: 0,    // which step of the fall-speed staircase we are on
  lockout: 0, // stops the killing shot from instantly restarting
};

// The books for one player, created on demand.
function book(id) {
  if (!state.books[id]) state.books[id] = { score: 0, combo: 1 };
  return state.books[id];
}
const myBook = () => book(state.me);

// A target reaching the ground is everyone's failure -- shields are shared, so
// the combo break is shared too. This is the line whose absence let clients
// climb to a permanent 5x while the host kept falling back to 1x.
function breakAllCombos() {
  for (const id of Object.keys(state.books)) state.books[id].combo = 1;
}

// Every shield loss goes through here. Returns true if that was the last one.
function loseShield() {
  if (CFG.infiniteLives) return false;
  if (MODES[state.mode] && MODES[state.mode].infinite) return false;
  state.lives--;
  return state.lives <= 0;
}

function setIdle() {
  state.phase = 'idle';
  targets.clear();
  boss.reset();
  hud.drawCenter([
    { text: 'NEON HORIZON', size: 84, color: HEX(PALETTE.sunTop) },
    { text: 'shoot everything that falls', size: 40, color: HEX(PALETTE.gridNear) },
    { text: CFG.classic ? 'pull trigger to start' : 'shoot a mode to start', size: 38, color: '#ffffff' },
  ]);
  hud.drawScore(state);
}

function startGame(mode = 'normal') {
  applyMode(mode);
  state.phase = 'playing';
  state.lives = CFG.lives;
  for (const id of Object.keys(state.books)) state.books[id] = { score: 0, combo: 1 };
  state.elapsed = 0;
  state.powerupIn = CFG.powerupEvery * 0.6;   // the first one arrives a little early
  state.tier = 0;
  targets.clear();
  targets.spawnTimer = 0.8;
  targets.spawnScale = 1;
  boss.reset();
  hud.drawCenter(null);
  hud.drawScore(state);
  Audio.startMusic();
}

function showGameOver() {
  hud.drawCenter([
    { text: 'SIGNAL LOST', size: 76, color: HEX(PALETTE.bomb) },
    { text: `SCORE ${myBook().score}`, size: 56, color: HEX(PALETTE.sunTop) },
    { text: `survived ${Math.floor(state.elapsed)}s`, size: 34, color: HEX(PALETTE.gridNear) },
    { text: CFG.classic ? 'pull trigger to retry' : 'shoot a mode to play again', size: 38, color: '#ffffff' },
  ]);
}

function endGame() {
  state.phase = 'over';
  state.lockout = 1.2;
  targets.clear();
  boss.reset();
  Audio.stopMusic();
  Audio.sfxGameOver();
  showGameOver();
}

// ------------------------------------------------------------------ firing
// Award a kill to one player and build their combo.
function score(id, fraction = 1) {
  const b = book(id);
  b.score += Math.round(CFG.pointsBase * fraction * b.combo);
  if (fraction === 1) b.combo = Math.min(CFG.comboMax, b.combo + CFG.comboStep);
}

// A shot connected. Every weapon ends up here -- a ray, each pellet of a
// shotgun, an orb arriving -- so the rules for what a hit is worth exist once.
function applyHit(target, damage) {
  // On a client the world belongs to the host, so a hit becomes a request. The
  // beam and the sound stay local and instant; only the kill waits, and the
  // host answers in a few milliseconds on a LAN.
  if (!net.soloOrHost) {
    net.send({ t: 'hit', id: target.id, dmg: damage });
    Audio.sfxExplode(target.hp > damage ? 1.9 : 1);
    return;
  }
  // A target with hit points left takes a lighter sound and a white flash, and
  // only the killing blow scores.
  if (targets.damage(target, damage, state.me)) {
    Audio.sfxExplode(1);
    onKill(target, state.me);
  } else {
    Audio.sfxExplode(1.9);
  }
  hud.drawScore(state);
}

// What a kill is worth. Host only -- clients learn the result from the next
// snapshot. Powerups pay out as an effect rather than points.
function onKill(target, killer) {
  const k = KINDS[target.kind];
  if (!k.powerup) {
    score(killer);
    return;
  }
  if (k.name === 'health') {
    // Shields are shared, so a health pack helps everyone -- which is exactly
    // why it is worth breaking off the meteors to get.
    // In classic it is one shield back; in normal it refills every one.
    state.lives = CFG.classic ? Math.min(CFG.lives, state.lives + 1) : CFG.lives;
    Audio.sfxBlip(660);
    setTimeout(() => Audio.sfxBlip(990), 90);
  } else {
    // Weapons belong to whoever shot the pickup.
    const b = book(killer);
    b.weapon = k.weapon;
    b.weaponT = CFG.weaponSeconds;
    Audio.sfxBlip(1320);
  }
}

// Weighted so health only turns up when it would actually help.
function pickPowerup() {
  const pool = ['rapid', 'shotgun', 'orb'];
  const spec = MODES[state.mode];
  const repairs = CFG.classic || !spec || spec.repair !== 'none';
  if (repairs && state.lives < CFG.lives) pool.push('health', 'health');
  const name = pool[Math.floor(Math.random() * pool.length)];
  return KINDS.findIndex((k) => k.name === name);
}

// How far a shot can reach the sun and what it becomes. Further than a meteor
// shot: the pulsars and the nebula hang a long way out.
const BOSS_RANGE = 140;
const bossHitsInFlight = [];   // { in: seconds until the bolt lands, damage, piece }

const fireHooks = {
  // Once per trigger pull, however many pellets it becomes. Returns false when
  // the pull should not shoot -- on the title or game-over screen it starts the
  // run instead.
  shot(weapon, origin, dir) {
    Audio.initAudio();
    if (state.phase !== 'playing') {
      let mode = 'normal';
      if (!CFG.classic) {
        // Shoot a mode button to start. A shot anywhere else is just a shot,
        // so you can see where you are aiming.
        mode = hud.pickMode(origin, dir);
        if (!mode) {
          Audio.sfxLaser(weapon);
          return true;
        }
      }
      if (net.soloOrHost) {
        if (state.lockout <= 0) startGame(mode);
      } else {
        net.send({ t: 'start', mode });   // only the host may start the world
      }
      return false;
    }
    if (state.paused) return false;
    Audio.sfxLaser(weapon);
    return true;
  },
  // A shot stops at whatever it reaches first -- a meteor in front of the sun
  // takes the hit, which is what makes the thrown meteors a shield as well as
  // a threat.
  ray(origin, dir, damage) {
    const hit = pickTarget(origin, dir, targets.active);
    const sun = boss.rayHit(origin, dir, hit ? hit.distance : BOSS_RANGE);
    if (sun) {
      // The shot is drawn as a bolt flying out there, so the hit lands when
      // the bolt does rather than the instant the trigger is pulled.
      bossHitsInFlight.push({ in: sun.t / BOLT_SPEED, damage, piece: sun.piece });
      return { distance: sun.t, far: true };
    }
    if (hit) applyHit(hit.target, damage);
    return hit;
  },
  // For the held beam's visuals between damage ticks: where would it land,
  // without hurting anything.
  probe(origin, dir) {
    const hit = pickTarget(origin, dir, targets.active);
    const sun = boss.rayHit(origin, dir, hit ? hit.distance : BOSS_RANGE);
    return sun ? { distance: sun.t } : hit;
  },
  streamOk() {
    return state.phase === 'playing' && !state.paused;
  },
  stream(on) {
    if (on) Audio.beamStart();
    else Audio.beamStop();
  },
  // Someone else's orb: where it would pop, without hurting anything.
  orbProbe(from, dir, len) {
    const hit = pickTarget(from, dir, targets.active, len, ORB_RADIUS);
    const sun = boss.rayHit(from, dir, hit ? hit.distance : len);
    return sun ? { distance: sun.t } : hit;
  },
  // A shot the other players should see. Visual only -- damage has already
  // gone to the host through `hit` and `bhit`.
  fx(msg) {
    if (CFG.classic || !net.connected || !net.peers.length) return;
    msg.t = 'fx';
    net.send(msg);
  },
  orbStep(from, dir, len, damage) {
    const hit = pickTarget(from, dir, targets.active, len, ORB_RADIUS);
    const sun = boss.rayHit(from, dir, hit ? hit.distance : len);
    if (sun) {
      applyBossHit(damage, sun.piece);
      return { distance: sun.t };
    }
    if (hit) applyHit(hit.target, damage);
    return hit;
  },
};

// `piece` is -1 for the whole sun, or which shard was hit.
function applyBossHit(damage, piece) {
  Audio.sfxExplode(0.7);
  if (!net.soloOrHost) {
    net.send({ t: 'bhit', dmg: damage, piece });
    return;
  }
  const points = boss.damage(damage, state.me, piece);
  if (points) score(state.me, points);
  hud.drawScore(state);
}

const blasters = new Blasters(renderer, scene, fireHooks);
blasters.camera = camera;

// Everyone else, as outlines standing beside you, with their shots coming
// from their outline's blaster. See ghosts.js.
const ghosts = new Ghosts(scene);
blasters.remoteMuzzle = (id, hand) => ghosts.muzzle(id, hand);
let poseIn = 0;
const POSE_EVERY = 0.1;   // seconds between pose updates

// ------------------------------------------------------------------- co-op
const net = new Net();
// ?host asks the relay to prefer this tab as the world's owner. Open the PC
// with it and the machine on mains power -- the one nobody lifts off their
// head mid-game -- does the hosting.
net.connect({ prefer: params.has('host') });

let lastWorldAt = 0;   // client: when the last snapshot landed
let clientLost = false;

const AWAY_PANEL = [
  { text: 'HOST IS AWAY', size: 64, color: HEX(PALETTE.sunTop) },
  { text: 'the world is paused', size: 34, color: HEX(PALETTE.gridNear) },
];
const LOST_PANEL = [
  { text: 'WAITING FOR HOST', size: 56, color: HEX(PALETTE.bomb) },
  { text: 'reconnecting', size: 34, color: HEX(PALETTE.gridNear) },
];

// A hidden tab gets its animation frames throttled to about one a second. The
// loop clamps dt to 50ms, so a host that alt-tabs or sets the headset down does
// not stop -- it runs the whole world at a twentieth speed and keeps
// broadcasting, and every player slides into slow motion with no explanation.
// Pausing outright is both honest and easy to recover from.
document.addEventListener('visibilitychange', () => {
  if (!net.soloOrHost) return;
  state.paused = document.hidden;
  if (state.phase === 'playing') {
    hud.drawCenter(state.paused ? AWAY_PANEL : null);
  }
  if (net.connected) broadcastWorld();   // tell them immediately, not in 50ms
});

// Host -> clients: the world. One message, sent on a clock.
function broadcastWorld() {
  net.send({
    t: 'w',
    targets: targets.snapshot(),
    phase: state.phase,
    paused: state.paused,
    elapsed: +state.elapsed.toFixed(2),
    tier: state.tier,
    lives: state.lives,
    mode: state.mode,
    // Everyone's books ride along with the world. There is no separate reply to
    // a client's shot: their score simply appears in the next snapshot, 50ms
    // later, which is one message type fewer to keep consistent.
    books: state.books,
    boss: boss.snapshot(),
  });
}

net.on('bhit', (msg) => {
  if (!net.soloOrHost) return;
  Audio.sfxExplode(0.7);
  const points = boss.damage(msg.dmg || 1, msg.from, msg.piece == null ? -1 : msg.piece);
  if (points) score(msg.from, points);
  hud.drawScore(state);
});

// Client -> host: "I hit target 7 for 1". The host decides whether that lands,
// because it owns hit points, and credits the kill to whoever sent it.
net.on('hit', (msg) => {
  if (!net.soloOrHost) return;
  const t = targets.byId.get(msg.id);
  if (!t) return;              // already dead here; the shot arrived too late
  if (targets.damage(t, msg.dmg || 1, msg.from)) {
    Audio.sfxExplode(1);
    onKill(t, msg.from);   // their kill, their reward -- the host only keeps books
  } else {
    Audio.sfxExplode(1.9);
  }
  hud.drawScore(state);
});

// Host -> clients: the world, plus whatever the host has been told about us.
net.on('w', (msg) => {
  if (net.soloOrHost) return;  // a stale broadcast from before promotion
  lastWorldAt = performance.now();
  if (msg.mode !== undefined && msg.mode !== state.mode) applyMode(msg.mode);

  // Phase first, then the snapshot. The other order loses the world: a
  // transition to idle runs setIdle(), which clears the target field one line
  // after it was filled in.
  if (msg.phase !== state.phase) {
    state.phase = msg.phase;
    if (msg.phase === 'playing') {
      hud.drawCenter(null);
      Audio.startMusic();
    } else if (msg.phase === 'over') {
      Audio.stopMusic();
      showGameOver();
    } else {
      setIdle();
    }
  }
  // A phase change clears the field on the host too, so suppress the client's
  // death-bursts for that frame -- otherwise every restart detonates the whole
  // particle pool on the clients while the host's screen stays clean.
  targets.applySnapshot(msg.targets, { silent: msg.phase !== 'playing' });

  state.elapsed = msg.elapsed;
  state.tier = msg.tier || 0;
  state.lives = msg.lives;
  state.books = msg.books || state.books;
  boss.apply(msg.boss);
  if (msg.paused !== state.paused) {
    state.paused = msg.paused;
    if (state.phase === 'playing') hud.drawCenter(state.paused ? AWAY_PANEL : null);
  }
  hud.drawScore(state);
});

net.on('pose', (msg) => {
  if (!CFG.classic) ghosts.pose(msg.from, msg);
});

net.on('fx', (msg) => {
  if (!CFG.classic) blasters.remoteFx(msg.from, msg);
});

net.on('start', (msg) => {
  if (net.soloOrHost && state.phase !== 'playing' && state.lockout <= 0) startGame(msg.mode);
});

// The old host is gone and we own the world now. Everything here is state that
// meant something different a moment ago, or was never maintained on a client.
net.on('promote', () => {
  // Ids are already safe: applySnapshot has been tracking the high-water mark
  // of every id the old host used, so minting resumes above the targets still
  // falling on this screen.
  state.tier = Math.floor(state.elapsed / CFG.speedEvery);
  targets.spawnTimer = 0.8;      // a beat before the first spawn we own
  state.paused = false;
  clientLost = false;
  state.lockout = Math.max(state.lockout, 0.3);  // do not restart on this frame
  clock.getDelta();              // discard the gap so frame one does not jump
  // Keep everyone's score -- it came across in the last snapshot, so nobody
  // loses their run when the host changes. The peers handler prunes whoever
  // has actually left and gives any newcomer a row.
  book(state.me);
  for (const id of net.peers) book(id);
  if (state.phase === 'playing') hud.drawCenter(null);
  broadcastWorld();              // give the clients an authoritative frame now
  hud.drawScore(state);
});

net.on('demote', () => {
  // We were host and are not any more. The new one owns the books.
  state.paused = false;
});

net.on('peers', () => {
  // Our books move to our assigned id the first time the relay names us.
  if (net.id && state.me !== net.id) {
    const mine = state.books[state.me] || { score: 0, combo: 1 };
    delete state.books[state.me];
    state.me = net.id;
    state.books[net.id] = mine;
  }
  book(state.me);
  if (net.soloOrHost) {
    // Everyone present gets a row immediately, not when they first score --
    // otherwise a player who has not killed anything yet is missing from the
    // scoreboard, and is missing from it again if they are promoted to host.
    for (const id of net.peers) book(id);
    for (const id of Object.keys(state.books)) {
      const n = Number(id);
      if (n !== state.me && !net.peers.includes(n)) delete state.books[id];
    }
  }
  // net.peers excludes us; msg.peers does not, so using the raw list here would
  // put the game in co-op mode the moment you open it alone.
  state.coop = net.peers.length > 0;
  ghosts.sync(net.connected ? [state.me, ...net.peers] : [], state.me);
  poseIn = 0;   // introduce ourselves to a newcomer straight away
  hud.drawScore(state);
});

// ------------------------------------------------------------------- loop
const clock = new THREE.Clock();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp after a headset stall
  const t = clock.elapsedTime;

  scenery.update(t);
  blasters.weapon = (!CFG.classic && myBook().weapon) || 'blaster';
  // The weapon timer is on the HUD, which only redraws on change. Nudge it once
  // a second while something is counting down.
  const secs = myBook().weapon ? Math.ceil(myBook().weaponT || 0) : -1;
  if (secs !== lastWeaponSecs) {
    lastWeaponSecs = secs;
    hud.drawScore(state);
  }
  blasters.update(dt);
  for (let i = bossHitsInFlight.length - 1; i >= 0; i--) {
    const h = bossHitsInFlight[i];
    h.in -= dt;
    if (h.in > 0) continue;
    bossHitsInFlight.splice(i, 1);
    // Whatever it was aimed at may have died or moved on while it flew;
    // boss.damage ignores a hit on something no longer there.
    if (state.phase === 'playing') applyBossHit(h.damage, h.piece);
  }
  if (padNoteFor > 0) {
    padNoteFor -= dt;
    if (padNoteFor <= 0) restoreCenter();
  }
  // Proof of life, sent from the frame loop so it stops when the game does.
  if (net.connected) net.keepAlive(dt);
  // Where we are standing and looking, for everyone else's outline of us.
  poseIn -= dt;
  if (poseIn <= 0 && net.connected && net.peers.length && !CFG.classic) {
    poseIn = POSE_EVERY;
    net.send({ t: 'pose', ...blasters.pose(renderer.xr.isPresenting) });
  }
  ghosts.update(dt);
  // The mode buttons, between runs.
  hud.showModes(!CFG.classic && state.phase !== 'playing');
  if (hud.modesShown) hud.hoverModes(blasters.aimRays(renderer.xr.isPresenting));
  updateDesktopLook(dt);
  // Flat screen: swing the panels round with the view so turning away from the
  // start facing does not also lose you the score and the prompts. In VR they
  // stay put -- see HUD.faceYaw.
  hud.faceYaw(renderer.xr.isPresenting ? 0 : look.yaw, dt, hud.modesShown ? 0.7 : 0);

  if (state.lockout > 0) state.lockout -= dt;

  // A client does not simulate the world: it moves what the host last sent so
  // motion stays smooth between snapshots, and waits to be corrected.
  if (!net.soloOrHost) {
    // Silence from the host means it crashed, slept, or lost the network. Say
    // so rather than integrating targets through the floor forever.
    const silence = performance.now() - lastWorldAt;
    if (lastWorldAt && silence > 2000 && !clientLost) {
      clientLost = true;
      hud.drawCenter(LOST_PANEL);
    } else if (clientLost && silence < 2000) {
      clientLost = false;
      hud.drawCenter(state.phase === 'playing' ? null : undefined);
      if (state.phase !== 'playing') setIdle();
    }
    if (!state.paused && !clientLost) {
      targets.update(dt, state.elapsed, false, false);
      boss.update(dt);
    }
    if (!renderer.xr.isPresenting) cues.draw([...targets.active, ...boss.cueTargets()], camera);
    renderer.render(scene, camera);
    return;
  }

  if (net.connected && net.due(dt)) broadcastWorld();

  // A paused host renders, so you can see where you left off, but does not
  // advance the world.
  if (state.paused) {
    renderer.render(scene, camera);
    return;
  }

  if (state.phase === 'playing') {
    state.elapsed += dt;

    // The staircase steps up silently otherwise, and "why am I suddenly
    // losing?" is a worse feeling than "right, it just got faster".
    const tier = Math.floor(state.elapsed / CFG.speedEvery);
    if (tier > state.tier && fallSpeedAt(state.elapsed) < CFG.fallMax + 0.001) {
      state.tier = tier;
      Audio.sfxBlip(440 + tier * 60);
    }

    // Guarded by ?classic, which is the game before the sun could come for you.
    if (!CFG.classic) boss.hostUpdate(dt);
    targets.spawnScale = boss.active ? CFG.bossSpawnScale : 1;

    const { landed, chained } = targets.update(dt, state.elapsed, true);

    let changed = false;
    let dead = false;
    for (const item of landed) {
      // A boss meteor costs more than one shield -- that is what makes it worth
      // the extra shots.
      for (let n = 0; n < (KINDS[item.kind].shields || 1); n++) {
        if (loseShield()) dead = true;
      }
      breakAllCombos();
      Audio.sfxMiss();
      changed = true;
    }

    // Powerups. Guarded by ?classic, which is the game before they existed.
    if (!CFG.classic) {
      state.powerupIn -= dt;
      if (state.powerupIn <= 0) {
        targets.spawnPowerup(pickPowerup());
        state.powerupIn = CFG.powerupEvery + (Math.random() * 2 - 1) * CFG.powerupJitter;
      }
      // Weapons run out. Everyone's timer ticks here, on the host, and reaches
      // the clients in the books.
      for (const id of Object.keys(state.books)) {
        const b = state.books[id];
        if (!b.weapon) continue;
        b.weaponT = Math.max(0, Math.round((b.weaponT - dt) * 100) / 100);
        if (b.weaponT <= 0) {
          delete b.weapon;
          delete b.weaponT;
          changed = true;
        }
      }
    }

    // Shrapnel kills. Scored at a fraction of a clean hit and they do not build
    // the combo -- the combo is for shots you aimed.
    let cascade = 0;
    for (let i = 0; i < chained.length; i++) {
      // Whoever fired the shot that started the cascade gets paid for it, not
      // whoever happens to be hosting.
      score(chained[i].killer != null ? chained[i].killer : state.me, CFG.blastPoints);
      // One noise for a ten-target cascade, not ten.
      if (cascade++ < 2) Audio.sfxExplode(1.3);
      changed = true;
    }

    if (changed) {
      hud.drawScore(state);
      if (dead) endGame();
    }
  } else {
    targets.update(dt, 0, false);
  }

  // Edge markers for whatever is falling outside the flat-screen view. Skipped
  // in VR, where the overlay is not composited into the headset anyway.
  if (!renderer.xr.isPresenting) cues.draw([...targets.active, ...boss.cueTargets()], camera);

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(tick);

// -------------------------------------------------------------- XR button
const vrBtn = document.getElementById('vrBtn');
const note = document.getElementById('note');

// itch.io runs the game inside an iframe on its own page, and a frame may not be
// allowed to start VR. The same game works when opened as a page of its own,
// so offer that instead of a dead button.
const inFrame = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();
const headsetBrowser = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent);

function offerOwnTab(reason) {
  vrBtn.disabled = false;
  vrBtn.textContent = 'OPEN FULL PAGE FOR VR';
  note.textContent = reason;
  vrBtn.onclick = () => window.open(location.href, '_blank');
}

async function setupXR() {
  if (!navigator.xr) {
    vrBtn.textContent = 'VR NOT AVAILABLE';
    vrBtn.disabled = true;
    note.textContent =
      'This browser has no WebXR. Open the page in the Meta Quest browser, ' +
      'or play the flat-screen version below with mouse + click.';
    return;
  }
  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported('immersive-vr');
  } catch {
    supported = false;   // a frame without VR permission can reject outright
  }
  if (!supported && inFrame && headsetBrowser) {
    offerOwnTab('VR cannot start inside this embedded page. Open the game on its own page, then press Enter VR.');
    return;
  }
  if (!supported) {
    vrBtn.textContent = 'NO VR HEADSET';
    vrBtn.disabled = true;
    note.textContent = 'No headset detected. Mouse to aim, click to shoot.';
    return;
  }
  vrBtn.disabled = false;
  vrBtn.textContent = 'ENTER VR';
  vrBtn.addEventListener('click', async () => {
    Audio.initAudio();
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
    } catch (err) {
      if (inFrame) offerOwnTab('This embedded page is not allowed to start VR. Open the game on its own page.');
      else note.textContent = `Could not start VR: ${err.message}`;
      return;
    }
    session.addEventListener('end', () => {
      vrBtn.textContent = 'ENTER VR';
      document.body.classList.remove('in-vr');
    });
    await renderer.xr.setSession(session);
    document.body.classList.add('in-vr');
    vrBtn.textContent = 'IN VR';
  });
}
setupXR();

// ------------------------------------------- desktop fallback (for testing)
// Targets fall from any bearing, so the flat-screen view has to turn all the
// way round. Pointer lock is the good path: relative mouse movement, unlimited
// yaw, exactly like any other FPS. Without it (lock refused, or the player hit
// Esc) the cursor steers instead -- push it toward a side of the screen and the
// view spins that way -- so you can still reach something behind you.
const look = { yaw: 0, pitch: 0 };
const LOOK_SENS = 0.0022;     // radians per pixel while pointer-locked
const STEER_DEAD = 0.35;      // inner fraction of the screen that does not turn
const STEER_RATE = 2.6;       // radians/sec of turn at the screen edge
const KEY_RATE = 2.2;         // radians/sec while holding a turn key
const PITCH_LIMIT = 1.35;     // just short of straight up/down

const canvasEl = renderer.domElement;
const cursor = { x: 0, y: 0, inside: false };
let pointerLocked = false;
let lockBlocked = false; // set if the browser refuses lock; then clicks fire

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

window.addEventListener('mousemove', (e) => {
  if (renderer.xr.isPresenting) return;
  if (pointerLocked) {
    look.yaw -= (e.movementX || 0) * LOOK_SENS;
    look.pitch = clamp(look.pitch - (e.movementY || 0) * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);
  } else {
    cursor.x = (e.clientX / window.innerWidth - 0.5) * 2;
    cursor.y = (e.clientY / window.innerHeight - 0.5) * 2;
    cursor.inside = true;
  }
});
// relatedTarget is null only when the pointer actually leaves the window --
// without that check, moving the cursor onto the UI overlay stops the steering.
window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) cursor.inside = false; });
window.addEventListener('blur', () => { cursor.inside = false; keys.clear(); blasters.releaseAll(); });

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvasEl;
});
document.addEventListener('pointerlockerror', () => { lockBlocked = true; });

// The mouse is a trigger like any other: down and up, so an automatic weapon
// keeps firing while it is held.
canvasEl.addEventListener('pointerdown', () => {
  if (renderer.xr.isPresenting) return;
  Audio.initAudio();
  // First click grabs the mouse rather than shooting, the way an FPS does.
  if (!pointerLocked && !lockBlocked && canvasEl.requestPointerLock) {
    const req = canvasEl.requestPointerLock();
    if (req && req.catch) req.catch(() => { lockBlocked = true; });
    return;
  }
  blasters.triggerDown('mouse');
});
addEventListener('pointerup', () => blasters.triggerUp('mouse'));

// --- Xbox controller -----------------------------------------------------------
const PAD_PANEL = (on) => [
  { text: on ? 'CONTROLLER CONNECTED' : 'CONTROLLER DISCONNECTED', size: 48,
    color: HEX(on ? PALETTE.gridNear : PALETTE.bomb) },
];
let padNoteFor = 0;
let lastWeaponSecs = -1;

// Put back whatever the centre panel should be showing for the current phase,
// after something borrowed it briefly.
function restoreCenter() {
  if (state.phase === 'over') showGameOver();
  else if (state.phase === 'idle') setIdle();
  else hud.drawCenter(state.paused ? AWAY_PANEL : null);
}
const pad = new Pad({
  onDown: () => {
    Audio.initAudio();
    blasters.triggerDown('pad');
  },
  onUp: () => blasters.triggerUp('pad'),
  onConnect: (on) => {
    // Say so briefly, but never cover a run in progress for long.
    hud.drawCenter(PAD_PANEL(on));
    padNoteFor = 1.5;
  },
});
blasters.pad = pad;

const keys = new Set();
let muted = false;
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === 'm') { muted = !muted; Audio.setMuted(muted); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function updateDesktopLook(dt) {
  if (renderer.xr.isPresenting) return;

  pad.update(dt, look, clamp, PITCH_LIMIT);

  // While the pad is in use the cursor keeps quiet. A mouse parked at the edge
  // of the screen otherwise steers against the stick forever and the view spins.
  if (!pad.recent && !pointerLocked && cursor.inside) {
    // Yaw is a rate, not a position: the crosshair stays at screen centre and
    // you steer it onto the target, which is what makes 360 reachable at all.
    const ax = Math.abs(cursor.x);
    if (ax > STEER_DEAD) {
      const push = (ax - STEER_DEAD) / (1 - STEER_DEAD);
      look.yaw -= Math.sign(cursor.x) * push * push * STEER_RATE * dt;
    }
    look.pitch = clamp(-cursor.y * 0.9, -PITCH_LIMIT, PITCH_LIMIT);
  }

  const turn = (keys.has('arrowleft') || keys.has('a') ? 1 : 0) -
               (keys.has('arrowright') || keys.has('d') ? 1 : 0);
  if (turn) look.yaw += turn * KEY_RATE * dt;

  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');

  if (shake > 0) {
    const a = 0.035 * shake * shake;
    camera.rotation.x += (Math.random() - 0.5) * a;
    camera.rotation.y += (Math.random() - 0.5) * a;
    shake = Math.max(0, shake - dt * 1.4);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cues.resize();
});

window.__NH = { CFG, net, pad, boss, ghosts, scenery, scene, renderer, camera, state, targets, blasters, hud, look, THREE };

setIdle();
