import * as THREE from '../vendor/three.module.js';
import { PALETTE, CFG, NEON } from './config.js';

const C = (hex) => new THREE.Color(hex);
// Shots draw after the sky's big pieces. The sun, its shards and the nebula
// all draw late (renderOrder 8-10) so they sit over the mountains -- and a
// beam that drew before them, writing no depth, was painted straight over.
// Still before the supernova (28+), which is meant to swallow everything.
const SHOT_ORDER = 20;
const MAX_RANGE = 60;
const FLASH = 0.16; // seconds a beam stays visible

// Never twice in a row -- back-to-back repeats read as "the colour is stuck".
let lastNeon = -1;
function pickNeon() {
  let i = Math.floor(Math.random() * NEON.length);
  if (i === lastNeon) i = (i + 1) % NEON.length;
  lastNeon = i;
  return NEON[i];
}

// A little neon blaster. Procedural -- no model files.
function makeBlaster() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x1a0033 })
  );
  body.position.z = -0.05;
  g.add(body);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: C(PALETTE.gridNear) })
  );
  edges.position.copy(body.position);
  g.add(edges);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8),
    new THREE.MeshBasicMaterial({ color: C(PALETTE.beam) })
  );
  barrel.rotation.x = -Math.PI / 2;
  barrel.position.z = -0.18;
  g.add(barrel);

  return g;
}

// Dim persistent aiming line so the player always knows where they point.
function makeAimLine() {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -MAX_RANGE),
  ]);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({
      color: C(PALETTE.gridNear),
      transparent: true,
      opacity: 0.25,
    })
  );
  line.frustumCulled = false;
  return line;
}

// The flat-screen beam needs its own geometry. The controller beam tapers to
// almost nothing, which is fine at arm's length but goes sub-pixel within a few
// metres when you are sighting straight down it. Uniform radius keeps the
// streak legible all the way out to the impact point.
function makeWorldBeam() {
  const geo = new THREE.CylinderGeometry(0.045, 0.045, 1, 8, 1, true);
  geo.translate(0, -0.5, 0);
  // Points +Z, unlike the controller beam. Object3D.lookAt aims a mesh's +Z at
  // the target (only cameras and lights use -Z), and this one is aimed by
  // lookAt rather than inheriting a controller's orientation.
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: C(PALETTE.beam),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  m.frustumCulled = false;
  m.visible = false;
  m.renderOrder = SHOT_ORDER;
  return m;
}

// Forgiving cylinder-cast: accept a hit if the target centre lies within
// (radius + padding) of the ray. Party guests should not need a steady hand.
const _toTarget = new THREE.Vector3();
const _closest = new THREE.Vector3();
function pickTarget(origin, dir, targets, range = MAX_RANGE, extraReach = 0) {
  let best = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const reach = (t.radius || CFG.targetRadius) + CFG.hitPadding + extraReach;
    _toTarget.subVectors(t.obj.position, origin);
    const along = _toTarget.dot(dir);
    if (along <= 0 || along > range) continue;
    _closest.copy(dir).multiplyScalar(along).add(origin);
    const perp = _closest.distanceTo(t.obj.position);
    if (perp <= reach && along < bestDist) {
      best = t;
      bestDist = along;
    }
  }
  return best ? { target: best, distance: bestDist } : null;
}

// What each weapon does. Every weapon is either rays (hitscan, resolved the
// instant the trigger fires) or an orb (a projectile that travels, and can miss
// because the target moved). Shotgun is simply several rays with spread.
export const WEAPONS = {
  blaster: { label: 'BLASTER', auto: false, cooldown: 0.11, rays: 1, spread: 0,     damage: 1 },
  rapid:   { label: 'RAPID',   auto: true,  cooldown: 0.09, rays: 1, spread: 0.014, damage: 1 },
  shotgun: { label: 'SHOTGUN', auto: false, cooldown: 0.42, rays: 7, spread: 0.11,  damage: 1 },
  orb:     { label: 'ORB',     auto: false, cooldown: 0.6,  orb: true,               damage: 3 },
};

const BEAMS = 32;          // worst case: your shotgun blasts plus everyone else's
// A shot at something far out in the sky -- the sun, the pulsars, the nebula --
// is a bolt you watch fly there, not an instant line. An instant hit on
// something eighty metres away reads as if it were at arm's length.
const BOLT_SPEED = 230;    // metres per second; main.js delays the damage to match
const BOLT_TRAIL = 14;     // metres of streak behind the head
const SPARKS = 10;
// A shot glancing off a boss that cannot be hurt yet: a smaller, paler spark
// with none of the shot's colour, where a hit is a bright neon starburst.
// `hit.deflect` marks one; over the network it travels as 2 where a real far
// hit is 1.
const DEFLECT = { gain: 0.8, size: 0.7, color: 0xb8c8ff };
const ORBS = 6;
const ORB_SPEED = 20;      // metres per second -- visibly slower than a beam
const ORB_LIFE = 3.2;      // seconds before a miss fizzles out
const ORB_RADIUS = 0.3;

function makeOrb() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(ORB_RADIUS, 1),
    new THREE.MeshBasicMaterial({ color: 0xfff6c0 })
  );
  const glow = new THREE.Mesh(
    new THREE.IcosahedronGeometry(ORB_RADIUS * 2.1, 1),
    new THREE.MeshBasicMaterial({
      color: C(PALETTE.sunTop),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  core.renderOrder = glow.renderOrder = SHOT_ORDER;
  g.add(core, glow);
  g.visible = false;
  return g;
}

// Sources of a trigger. The flat-screen mouse and the Xbox pad both aim from
// the camera; VR hands (0 and 1) aim from their controller.
const CAMERA_SOURCES = new Set(['mouse', 'pad']);
// How a source is named to other players: which gun on their outline of us.
const handCode = (source) => (CAMERA_SOURCES.has(source) ? -1 : source);
// What a shot reached: 0 nothing, 1 something it hurts, 2 a boss it glances off.
const hitCode = (hit) => (!hit ? 0 : hit.deflect ? 2 : 1);
const round = (v) => Math.round(v * 100) / 100;
const vec = (v) => [round(v.x), round(v.y), round(v.z)];
const REMOTE_STREAM_HZ = 15;     // how often a held beam tells the others where it lands
const REMOTE_STREAM_STALE = 0.4; // a remote beam with no word for this long has stopped

// Scratch for the per-frame paths (held beams, bolts in flight, sparks, aim
// rays). Allocating these every frame feeds the garbage collector, and on a
// Quest a collection is a visible hitch. Nothing here outlives the call that
// fills it -- anything kept is copied out.
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _muzzle = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _impact = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _side = new THREE.Vector3();
const _face = new THREE.Vector3();
const _basis = new THREE.Matrix4();
const _headAt = new THREE.Vector3();
const _look = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

// --- the held beam ----------------------------------------------------------
// Click the blaster and you get one laser. Hold it and, after a moment, that
// becomes a solid beam that sweeps through the neon rainbow along its length.
// It deals damage in ticks rather than every frame, so it is a smoother way to
// do roughly what fast clicking does, not a strictly better one.
const STREAM = {
  delay: 0.22,     // how long a press must be held before it turns into a beam
  tick: 0.16,      // seconds between damage ticks
  damage: 1,
};

export function makeStream() {
  // A flat ribbon, not a cylinder. The beam starts beside your eye and runs
  // away from you, so you see it nearly end-on -- and a cylinder seen end-on
  // has no side facing the camera to shade. A ribbon turned to face the camera
  // every frame keeps its full width and a clean bright centre from any angle.
  //
  // Local space: width along X (-0.5..0.5), length along Z (0..1).
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0,   0.5, 0, 0,   -0.5, 0, 1,   0.5, 0, 1,
  ], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geo.setIndex([0, 2, 1, 2, 3, 1]);

  // Two layers from one shader: a hot core, and a wide soft sheath around it
  // that does the job a bloom pass would, without the cost of one.
  const layer = (glow) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uLen: { value: 1 }, uAlpha: { value: 0 }, uGlow: { value: glow ? 1 : 0 },
    },
    vertexShader: [
      'uniform float uLen;',
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      // Past 30 metres the ribbon widens with distance, so a beam reaching a
      // boss far out in the sky stays a beam instead of thinning to a thread.
      '  vec3 p = position;',
      '  p.x *= 1.0 + max(0.0, p.z * uLen - 30.0) * 0.05;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime; uniform float uLen; uniform float uAlpha; uniform float uGlow;',
      'varying vec2 vUv;',
      'vec3 hue(float h) {',
      '  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);',
      '  return k * k * (3.0 - 2.0 * k);',
      '}',
      'void main() {',
      '  float along = vUv.y * uLen;',
      '  float across = abs(vUv.x - 0.5) * 2.0;',
      // Colour flows away from the player down the beam -- a full rainbow every
      // seven metres or so -- while the whole spectrum slowly drifts.
      '  vec3 c = hue(along * 0.14 - uTime * 0.9);',
      '  float pulse = 0.78 + 0.22 * sin(along * 2.2 - uTime * 28.0);',
      '  float a;',
      '  vec3 col;',
      '  if (uGlow > 0.5) {',
      '    float g = pow(1.0 - across, 2.2);',
      '    a = g * 0.45;',
      '    col = c * 1.3;',
      '  } else {',
      '    float body = pow(1.0 - across, 1.6);',
      '    float hot = pow(1.0 - across, 7.0);',
      '    a = body;',
      '    col = mix(c, vec3(1.0), hot * 0.8) * 2.4;',
      '  }',
      // Fade in from the muzzle so the start does not look cut off.
      '  a *= uAlpha * pulse * smoothstep(0.0, 0.8, along);',
      '  gl_FragColor = vec4(col * a, a);',
      '}',
    ].join('\n'),
  });

  const group = new THREE.Group();
  const core = new THREE.Mesh(geo, layer(false));
  const glow = new THREE.Mesh(geo, layer(true));
  glow.scale.set(4, 1, 1);
  core.frustumCulled = glow.frustumCulled = false;
  glow.renderOrder = SHOT_ORDER;
  core.renderOrder = SHOT_ORDER + 1;
  group.add(glow, core);
  group.visible = false;
  return group;
}

// A flickering starburst where the beam lands. Deliberately not the explosion
// pool: those bursts are live shrapnel, and a beam that sprayed them would chain
// through everything it touched.
function makeSpark() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uGain: { value: 1 } },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float uGain;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 p = (vUv - 0.5) * 2.0;',
        '  float r = length(p);',
        '  float a = atan(p.y, p.x);',
        '  float rays = pow(abs(sin(a * 4.0 + uTime * 9.0)), 12.0) * (1.0 - r);',
        '  float glow = exp(-r * 4.0);',
        '  float k = clamp(glow + rays * 0.9, 0.0, 1.0) * (0.8 + 0.2 * sin(uTime * 60.0));',
        // Gain dims through alpha alone: additive blending already squares k.
        '  gl_FragColor = vec4(mix(uColor, vec3(1.0), glow * uGain) * k, k * uGain);',
        '}',
      ].join('\n'),
    })
  );
  m.frustumCulled = false;
  m.visible = false;
  m.renderOrder = SHOT_ORDER + 2;
  return m;
}


export class Blasters {
  // `hooks` is how the game hears about shots. This file draws beams and moves
  // orbs; deciding what they hit and what that is worth lives in main.js, which
  // owns the target field and the network.
  //   shot(weapon, origin, dir)      -> false to swallow the shot (it started the game)
  //   ray(origin, dir, damage)       -> hit or null
  //   orbStep(from, dir, len, dmg)   -> hit or null
  //   probe(origin, dir)             -> hit or null, without doing damage
  //   streamOk()                     -> whether a held beam may fire right now
  //   stream(on)                     -> the beam started or stopped, for sound
  //   orbProbe(from, dir, len)       -> what another player's orb would hit, harmlessly
  //   fx(msg)                        -> a shot other players should see
  constructor(renderer, scene, hooks) {
    this.hooks = hooks;
    this.camera = null;
    this.pad = null;              // set by main so pad shots can rumble
    this.weapon = 'blaster';
    this.hands = [];
    this.held = new Map();        // source -> true while its trigger is down
    this.cooldown = new Map();    // source -> seconds until it may fire again
    this.heldFor = new Map();     // source -> seconds its trigger has been down
    this.queued = new Set();      // sources pressed during their cooldown
    this.streams = new Map();     // source -> the held rainbow beam
    this.scene = scene;
    this.clock = 0;
    // Other players' shots, drawn from their outlines. `remoteMuzzle(id, hand)`
    // is set by main and says where one of those outlines is holding its gun.
    this.remoteMuzzle = null;
    this.remoteStreams = new Map(); // "id:hand" -> a held beam someone else is firing

    this.beams = [];
    for (let i = 0; i < BEAMS; i++) {
      const b = makeWorldBeam();
      b.userData.flash = 0;
      scene.add(b);
      this.beams.push(b);
    }

    // Starbursts where a bolt lands.
    this.sparks = [];
    for (let i = 0; i < SPARKS; i++) {
      const s = makeSpark();
      s.userData.life = 0;
      scene.add(s);
      this.sparks.push(s);
    }

    this.orbs = [];
    for (let i = 0; i < ORBS; i++) {
      const o = makeOrb();
      o.userData = { life: 0, dir: new THREE.Vector3(), damage: 0 };
      scene.add(o);
      this.orbs.push(o);
    }

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      controller.add(makeBlaster(), makeAimLine());
      scene.add(controller);

      const hand = { controller, connected: false, inputSource: null };
      controller.addEventListener('selectstart', () => this.triggerDown(i));
      controller.addEventListener('selectend', () => this.triggerUp(i));
      controller.addEventListener('connected', (e) => {
        hand.connected = true;
        hand.inputSource = e.data;
      });
      controller.addEventListener('disconnected', () => {
        hand.connected = false;
        hand.inputSource = null;
        this.triggerUp(i);
      });
      this.hands.push(hand);
    }
  }

  get spec() {
    return WEAPONS[this.weapon] || WEAPONS.blaster;
  }

  // A press always tries to fire at once -- a semi-auto weapon that waited for
  // the next frame would feel like input lag. Holding only matters to automatics.
  // A press during the cooldown is kept and fires the moment it ends: dropped,
  // a quick double-click on the shotgun or orb lost every other shot silently.
  triggerDown(source) {
    if (this.held.get(source)) return;
    this.held.set(source, true);
    this.heldFor.set(source, 0);
    if ((this.cooldown.get(source) || 0) <= 0) this.fire(source);
    else if (!CFG.classic) this.queued.add(source);
  }

  triggerUp(source) {
    this.held.delete(source);
    this.heldFor.delete(source);
    this._stopStream(source);
  }

  releaseAll() {
    for (const source of [...this.held.keys()]) this.triggerUp(source);
    this.queued.clear();
  }

  _stream(source) {
    let s = this.streams.get(source);
    if (!s) {
      s = { beam: makeStream(), spark: makeSpark(), on: false, tickIn: 0 };
      this.scene.add(s.beam, s.spark);
      this.streams.set(source, s);
    }
    return s;
  }

  _stopStream(source) {
    const s = this.streams.get(source);
    if (!s || !s.on) return;
    s.on = false;
    s.beam.visible = false;
    s.spark.visible = false;
    if (this.hooks.fx) this.hooks.fx({ k: 'beam', s: handCode(source), off: 1 });
    if (this.hooks.stream && ![...this.streams.values()].some((x) => x.on)) this.hooks.stream(false);
  }

  _updateStream(source, dt) {
    const s = this._stream(source);
    if (!this.hooks.streamOk || !this.hooks.streamOk()) {
      this._stopStream(source);
      return;
    }
    if (!s.on) {
      s.on = true;
      s.tickIn = 0;
      s.alpha = 0;
      if (this.hooks.stream) this.hooks.stream(true);
    }

    const origin = _origin;
    const dir = _dir;
    const quat = _quat;
    this._aim(source, origin, dir, quat);
    const flat = CAMERA_SOURCES.has(source);
    const muzzle = _muzzle.copy(origin);
    if (flat) {
      const right = _right.set(1, 0, 0).applyQuaternion(quat);
      const up = _up.set(0, 1, 0).applyQuaternion(quat);
      muzzle.addScaledVector(right, 0.9).addScaledVector(up, -0.7).addScaledVector(dir, 2.0);
    }

    // Damage in ticks; the visual follows the aim every frame.
    s.tickIn -= dt;
    let hit;
    if (s.tickIn <= 0) {
      s.tickIn = STREAM.tick;
      hit = this.hooks.ray(origin, dir, STREAM.damage);
      const landed = !!hit && !hit.deflect;
      if (flat && landed && this.hooks.mark) this.hooks.mark();
      if (source === 'pad' && this.pad) this.pad.rumble(landed ? 0.35 : 0.15, 90);
      else if (!flat) this._feedback(source, landed, { rays: 1 });
    } else {
      hit = this.hooks.probe(origin, dir);
    }

    const len = hit ? hit.distance : MAX_RANGE;
    const impact = _impact.copy(origin).addScaledVector(dir, len);
    const width = (flat ? 0.16 : 0.07) * (1 + Math.sin(this.clock * 31) * 0.1);
    this._drawStream(s, muzzle, impact, hitCode(hit), width, flat ? 1.6 : 0.9, dt);

    // Tell the others where it lands, a few times a second. They draw it from
    // their outline of us and smooth between updates.
    s.sendIn = (s.sendIn || 0) - dt;
    if (s.sendIn <= 0 && this.hooks.fx) {
      s.sendIn = 1 / REMOTE_STREAM_HZ;
      this.hooks.fx({ k: 'beam', s: handCode(source), e: vec(impact), h: hitCode(hit) });
    }
  }

  // Lay a rainbow ribbon from `muzzle` to `impact`, turned to face this camera.
  // `hit` is a hitCode: 0 nothing there, 1 a hit, 2 glancing off.
  _drawStream(s, muzzle, impact, hit, width, sparkScale, dt) {
    const length = Math.max(0.01, muzzle.distanceTo(impact));
    s.alpha = Math.min(1, (s.alpha || 0) + dt * 8);
    const eye = _eye;
    this.camera.getWorldPosition(eye);
    const fwd = _fwd.copy(impact).sub(muzzle).normalize();
    const mid = _mid.copy(muzzle).lerp(impact, 0.3);
    const side = _side.crossVectors(fwd, eye.sub(mid));
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    // fwd x side, not side x fwd: makeBasis needs a right-handed frame, and the
    // other order is a mirror image that setFromRotationMatrix cannot represent.
    const face = _face.crossVectors(fwd, side).normalize();
    s.beam.position.copy(muzzle);
    s.beam.quaternion.setFromRotationMatrix(_basis.makeBasis(side, face, fwd));
    s.beam.scale.set(width, 1, length);
    for (const layer of s.beam.children) {
      const u = layer.material.uniforms;
      u.uTime.value = this.clock % 600;
      u.uLen.value = length;
      u.uAlpha.value = s.alpha;
    }
    s.beam.visible = true;

    s.spark.visible = !!hit;
    if (hit) {
      const dim = hit === 2;
      this.camera.getWorldPosition(eye);
      s.spark.position.copy(impact).addScaledVector(fwd, -0.2);
      s.spark.lookAt(eye);
      s.spark.scale.setScalar(sparkScale);
      const u = s.spark.material.uniforms;
      u.uTime.value = this.clock % 600;
      u.uGain.value = dim ? DEFLECT.gain : 1;
      // The spark takes whatever colour the beam is at the far end.
      const h = ((length * 0.14 - this.clock * 0.9) % 1 + 1) % 1;
      if (dim) u.uColor.value.set(DEFLECT.color);
      else u.uColor.value.setHSL(h, 1, 0.6);
    }
  }

  // Where we are, for other players' outline of us: head, and each tracked hand
  // in VR. Rounded, since it goes out ten times a second.
  pose(vr) {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const pack = (obj) => {
      obj.getWorldPosition(p);
      obj.getWorldQuaternion(q);
      const r3 = (v) => Math.round(v * 1000) / 1000;
      return [r3(p.x), r3(p.y), r3(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w)];
    };
    return {
      h: pack(this.camera),
      g: vr ? this.hands.map((hand) => (hand.connected ? pack(hand.controller) : 0)) : 0,
    };
  }

  // Every way the player is currently aiming: the view on a flat screen, each
  // tracked controller in VR. For lighting up whatever they point at.
  // Called every frame on the menus, so the rays are kept and refilled: the
  // array and its entries are only good until the next call.
  aimRays(vr) {
    const out = this._aimRays || (this._aimRays = []);
    const pool = this._aimPool || (this._aimPool = []);
    out.length = 0;
    const add = (source) => {
      const r = pool[out.length] || (pool[out.length] = { origin: new THREE.Vector3(), dir: new THREE.Vector3() });
      this._aim(source, r.origin, r.dir, _quat);
      out.push(r);
    };
    if (vr) this.hands.forEach((h, i) => { if (h.connected) add(i); });
    else add('mouse');
    return out;
  }

  _aim(source, origin, dir, quat) {
    const obj = CAMERA_SOURCES.has(source) ? this.camera : this.hands[source].controller;
    obj.getWorldPosition(origin);
    obj.getWorldQuaternion(quat);
    dir.set(0, 0, -1).applyQuaternion(quat);
  }

  fire(source) {
    const spec = this.spec;
    this.cooldown.set(source, spec.cooldown);
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    this._aim(source, origin, dir, quat);
    if (!this.hooks.shot(this.weapon, origin, dir)) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);

    // Where the visible shot starts. From the eye a beam is foreshortened to a
    // dot -- you are looking straight down it -- so on a flat screen it sweeps
    // in from the lower right like a tracer. In VR it leaves the hand.
    const flat = CAMERA_SOURCES.has(source);
    const muzzle = origin.clone();
    if (flat) muzzle.addScaledVector(right, 0.9).addScaledVector(up, -0.7).addScaledVector(dir, 2.0);

    let anyHit = false;
    if (spec.orb) {
      // The orb flies along the aim line from the eye, so it lands on the
      // crosshair; it only *starts* at the muzzle visually on a flat screen.
      const start = flat ? origin.clone().addScaledVector(dir, 1.2) : muzzle;
      this._launchOrb(start, dir, spec.damage);
      if (this.hooks.fx) this.hooks.fx({ k: 'orb', s: handCode(source), o: vec(start), d: vec(dir) });
    } else {
      const color = pickNeon();
      const impacts = [];
      const far = [];
      for (let r = 0; r < spec.rays; r++) {
        const d = dir.clone();
        if (spec.spread > 0) {
          // A disc of jitter rather than a square, so the pattern reads round.
          const a = Math.random() * Math.PI * 2;
          const m = Math.sqrt(Math.random()) * spec.spread;
          d.addScaledVector(right, Math.cos(a) * m).addScaledVector(up, Math.sin(a) * m).normalize();
        }
        const hit = this.hooks.ray(origin, d, spec.damage);
        if (hit && !hit.deflect) anyHit = true;
        const impact = origin.clone().addScaledVector(d, hit ? hit.distance : MAX_RANGE);
        const bolt = hit && hit.far ? hitCode(hit) : 0;
        this._beam(muzzle, impact, color, flat ? 1 : 0.5, bolt);
        impacts.push(...vec(impact));
        far.push(bolt);
      }
      if (this.hooks.fx) this.hooks.fx({ k: 'ray', s: handCode(source), c: color, e: impacts, f: far });
    }
    this._feedback(source, anyHit, spec);
  }

  // Another player fired. Draw it from their outline, toward where their shot
  // actually went -- the world is shared, so their impact point is right here
  // too. Visual only: whatever it hit, the host has already been told.
  remoteFx(id, m) {
    const from = this.remoteMuzzle && this.remoteMuzzle(id, m.s, _from);
    if (!from) return;
    if (m.k === 'ray' && Array.isArray(m.e)) {
      for (let i = 0; i + 2 < m.e.length; i += 3) {
        const bolt = Array.isArray(m.f) ? m.f[i / 3] || 0 : 0;
        this._beam(from, _to.set(m.e[i], m.e[i + 1], m.e[i + 2]), m.c, 0.7, bolt);
      }
    } else if (m.k === 'orb' && m.o && m.d) {
      // Fly toward a point well down their orb's path, so it converges on the
      // line theirs is really travelling.
      const aim = _impact.fromArray(m.o).addScaledVector(_dir.fromArray(m.d), 25);
      this._launchOrb(from, aim.sub(from).normalize(), 0, true);
    } else if (m.k === 'beam') {
      const key = `${id}:${m.s}`;
      let s = this.remoteStreams.get(key);
      if (m.off) {
        if (s) this._hideRemoteStream(s);
        return;
      }
      if (!Array.isArray(m.e)) return;
      if (!s) {
        s = { beam: makeStream(), spark: makeSpark(), on: false, id, hand: m.s,
          impact: new THREE.Vector3(), goal: new THREE.Vector3(), hit: false, age: 0, alpha: 0 };
        this.scene.add(s.beam, s.spark);
        this.remoteStreams.set(key, s);
      }
      s.goal.fromArray(m.e);
      if (!s.on) {
        s.on = true;
        s.alpha = 0;
        s.impact.copy(s.goal);
      }
      s.hit = m.h === 2 ? 2 : m.h ? 1 : 0;
      s.age = 0;
    }
  }

  _hideRemoteStream(s) {
    s.on = false;
    s.beam.visible = false;
    s.spark.visible = false;
  }

  // Someone left (or we dropped off the relay): take their held beams out of
  // the scene for good. `ids` is everyone still here; anyone else goes.
  pruneRemote(ids) {
    const here = new Set(ids.map(String));
    for (const [key, s] of this.remoteStreams) {
      if (here.has(String(s.id))) continue;
      this.scene.remove(s.beam, s.spark);
      // Core and glow share one geometry; each has its own material.
      s.beam.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      s.spark.geometry.dispose();
      s.spark.material.dispose();
      this.remoteStreams.delete(key);
    }
  }

  // `bolt` is a hitCode: 0 an instant line, 1 a bolt flying out to a hit,
  // 2 a bolt that glances off.
  _beam(from, to, color, thickness, bolt = 0) {
    const b = this.beams.find((x) => x.userData.flash <= 0 && !x.userData.bolt) || this.beams[0];
    b.position.copy(from);
    b.lookAt(to);
    b.scale.set(thickness, thickness, from.distanceTo(to));
    b.material.color.set(color);
    b.material.opacity = 1;
    b.visible = true;
    b.userData.flash = FLASH;
    b.userData.bolt = null;
    if (bolt) {
      // Fly first; the flash of the whole line starts when it arrives.
      // One record per beam, refilled each shot rather than made fresh.
      const u = b.userData.boltState || (b.userData.boltState = {
        from: new THREE.Vector3(), to: new THREE.Vector3(), dir: new THREE.Vector3(),
      });
      u.from.copy(from);
      u.to.copy(to);
      u.dir.copy(to).sub(from).normalize();
      u.dist = from.distanceTo(to);
      u.run = 0;
      u.thickness = thickness;
      u.color = color;
      u.dim = bolt === 2;
      b.userData.bolt = u;
      b.userData.flash = FLASH * 1.6;
      this._placeBolt(b);
    }
  }

  // The streak between the bolt's tail and head, thickened with distance from
  // the eye so it stays several pixels wide all the way out.
  _placeBolt(b) {
    const u = b.userData.bolt;
    const head = Math.min(u.dist, u.run);
    const tail = Math.max(0, head - BOLT_TRAIL);
    const dir = u.dir;
    b.position.copy(u.from).addScaledVector(dir, tail);
    const headAt = _headAt.copy(u.from).addScaledVector(dir, head);
    b.lookAt(_look.copy(headAt).addScaledVector(dir, 1));
    const eye = _eye;
    this.camera.getWorldPosition(eye);
    const th = u.thickness * 1.8 * Math.max(1, headAt.distanceTo(eye) / 14);
    b.scale.set(th, th, Math.max(0.01, head - tail));
  }

  _spark(at, size, color, gain = 1) {
    const s = this.sparks.find((x) => x.userData.life <= 0) || this.sparks[0];
    s.position.copy(at);
    s.scale.setScalar(size);
    s.material.uniforms.uColor.value.set(color);
    s.material.uniforms.uGain.value = gain;
    s.userData.life = 0.28;
    s.userData.size = size;
    s.visible = true;
  }

  _launchOrb(from, dir, damage, remote = false) {
    const o = this.orbs.find((x) => x.userData.life <= 0) || this.orbs[0];
    o.position.copy(from);
    o.userData.dir.copy(dir);
    o.userData.life = ORB_LIFE;
    o.userData.damage = damage;
    o.userData.remote = remote;
    o.visible = true;
  }

  _feedback(source, hit, spec) {
    const strong = spec.orb ? 0.5 : hit ? 0.6 : 0.22;
    const ms = spec.rays > 1 ? 90 : hit ? 60 : 30;
    // A flat screen has no hands to buzz, so a hit shows on the crosshair.
    if (hit && CAMERA_SOURCES.has(source) && this.hooks.mark) this.hooks.mark();
    if (source === 'pad') {
      if (this.pad) this.pad.rumble(strong, ms);
      return;
    }
    if (source === 'mouse') return;
    const src = this.hands[source] && this.hands[source].inputSource;
    const act = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (act) act.pulse(strong, ms);
  }

  update(dt) {
    this.clock += dt;

    // Held beams. Only the plain blaster turns into one -- the pickups keep
    // their own feel, and a held rapid-fire already does something.
    for (const [source, t] of this.heldFor) {
      const held = t + dt;
      this.heldFor.set(source, held);
      if (this.weapon === 'blaster' && held >= STREAM.delay) this._updateStream(source, dt);
      else this._stopStream(source);
    }

    // Cooldowns, and automatic fire for anything still held.
    for (const [source, t] of this.cooldown) {
      const left = t - dt;
      this.cooldown.set(source, left);
      if (left > 0) continue;
      if (this.queued.delete(source) || (this.held.get(source) && this.spec.auto)) this.fire(source);
    }

    // Other players' held beams: follow their outline's gun, glide toward the
    // latest impact point, and stop if they go quiet.
    for (const s of this.remoteStreams.values()) {
      if (!s.on) continue;
      s.age += dt;
      const from = s.age < REMOTE_STREAM_STALE && this.remoteMuzzle && this.remoteMuzzle(s.id, s.hand, _from);
      if (!from) {
        this._hideRemoteStream(s);
        continue;
      }
      s.impact.lerp(s.goal, 1 - Math.exp(-dt * 18));
      this._drawStream(s, from, s.impact, s.hit, 0.15 * (1 + Math.sin(this.clock * 31) * 0.1), 1.4, dt);
    }

    for (const s of this.sparks) {
      const u = s.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      this.camera.getWorldPosition(_eye);
      s.lookAt(_eye);
      s.scale.setScalar(u.size * (0.6 + u.life * 2.5));
      s.material.uniforms.uTime.value = this.clock % 600;
      if (u.life <= 0) s.visible = false;
    }

    for (const b of this.beams) {
      const bolt = b.userData.bolt;
      if (bolt) {
        bolt.run += BOLT_SPEED * dt;
        if (bolt.run < bolt.dist) {
          this._placeBolt(b);
          continue;
        }
        // Arrived: the whole laser flashes from muzzle to target, thick enough
        // to see at that range, with a starburst where it struck.
        b.userData.bolt = null;
        b.position.copy(bolt.from);
        b.lookAt(bolt.to);
        const th = bolt.thickness;
        b.scale.set(th, th, bolt.dist);
        this.camera.getWorldPosition(_eye);
        const size = Math.max(1.5, bolt.to.distanceTo(_eye) * 0.09);
        if (bolt.dim) this._spark(bolt.to, size * DEFLECT.size, DEFLECT.color, DEFLECT.gain);
        else this._spark(bolt.to, size, bolt.color);
      }
      if (b.userData.flash <= 0) continue;
      b.userData.flash -= dt;
      b.material.opacity = Math.max(0, b.userData.flash / FLASH);
      if (b.userData.flash <= 0) b.visible = false;
    }

    for (const o of this.orbs) {
      const u = o.userData;
      if (u.life <= 0) continue;
      u.life -= dt;
      const step = ORB_SPEED * dt;
      // Test the whole stretch travelled this frame rather than where the orb
      // ends up, or at a low framerate it steps straight over a target.
      // Someone else's orb only needs to know where to pop; their own game
      // does the damage.
      const hit = u.remote
        ? this.hooks.orbProbe && this.hooks.orbProbe(o.position, u.dir, step)
        : this.hooks.orbStep(o.position, u.dir, step, u.damage);
      o.position.addScaledVector(u.dir, step);
      const pulse = 1 + Math.sin(u.life * 30) * 0.12;
      o.scale.set(pulse, pulse, pulse);
      // An orb lands after the trigger's feedback has gone, so it marks the
      // crosshair itself when it pops on something.
      if (hit && !hit.deflect && !u.remote && this.hooks.mark) this.hooks.mark();
      if (hit || u.life <= 0) {
        u.life = 0;
        o.visible = false;
      }
    }
  }
}

export { pickTarget, MAX_RANGE, ORB_RADIUS, BOLT_SPEED };
