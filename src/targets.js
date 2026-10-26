import * as THREE from '../vendor/three.module.js';
import { PALETTE, CFG, NEON, fallSpeedAt } from './config.js';

const C = (hex) => new THREE.Color(hex);

// Shared geometry/material -- one allocation for the whole game.
const SHELL_GEO = new THREE.IcosahedronGeometry(CFG.targetRadius, 0);
const WIRE_GEO = new THREE.EdgesGeometry(SHELL_GEO);
const CORE_GEO = new THREE.IcosahedronGeometry(CFG.targetRadius * 0.72, 0);

function makeBody(color) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    CORE_GEO,
    new THREE.MeshBasicMaterial({ color: C(PALETTE.targetCore) })
  );
  const wire = new THREE.LineSegments(
    WIRE_GEO,
    new THREE.LineBasicMaterial({ color: C(color) })
  );
  g.add(core, wire);
  return g;
}

// ----------------------------------------------------------- explosions
// Fixed pool of particle bursts, recycled. Allocating these mid-game is the
// fastest way to make a Quest hitch. The pool is sized for the worst case --
// one shot cascading down a whole column of targets -- so a chain reaction
// never has to steal a burst that is still on screen.
const HOLD = 0.4; // fraction of life held at full brightness before the fade

const _tmpC = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const FLASH_TIME = 0.13; // seconds a damaged target stays white

// A bare Points material draws hard squares. At this size, lingering this long,
// that reads as falling confetti; a soft round sprite reads as a spark. Drawn
// on a canvas rather than loaded, like everything else here.
function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
let SPARK_TEX = null;

class ExplosionPool {
  constructor(scene, count = 20, particles = 52) {
    this.items = [];
    SPARK_TEX = SPARK_TEX || makeSparkTexture();
    for (let i = 0; i < count; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(particles * 3), 3));
      // Per-particle colour: one burst is a spray of different neons, not a
      // cloud of one. Costs an attribute upload per frame and nothing else.
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(particles * 3), 3));
      const mat = new THREE.PointsMaterial({
        size: 0.32,
        map: SPARK_TEX,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      scene.add(points);
      this.items.push({
        points,
        vel: new Float32Array(particles * 3),
        n: particles,
        life: 0,
        center: new THREE.Vector3(),
        owner: null,
      });
    }
  }

  // `color` pins every particle to one hex. Leave it out and each particle picks
  // its own neon, which is the normal case.
  // `owner` is the peer id whose shot caused this. It rides along so that a
  // cascade pays whoever started it rather than whoever happens to be hosting.
  burst(position, color, owner = null) {
    const it = this.items.find((x) => x.life <= 0) || this.items[0];
    const pos = it.points.geometry.attributes.position;
    const col = it.points.geometry.attributes.color;
    for (let i = 0; i < it.n; i++) {
      pos.array[i * 3] = position.x;
      pos.array[i * 3 + 1] = position.y;
      pos.array[i * 3 + 2] = position.z;
      // random direction, random speed
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = 1.1 + Math.random() * 2.6;
      it.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      it.vel[i * 3 + 1] = Math.cos(ph) * s;
      it.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;

      _tmpC.set(color != null ? color : NEON[(Math.random() * NEON.length) | 0]);
      col.array[i * 3] = _tmpC.r;
      col.array[i * 3 + 1] = _tmpC.g;
      col.array[i * 3 + 2] = _tmpC.b;
    }
    it.center.copy(position);
    it.owner = owner;
    it.points.material.opacity = 1;
    it.points.visible = true;
    it.life = CFG.blastLife;
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      const arr = it.points.geometry.attributes.position.array;
      for (let i = 0; i < it.n; i++) {
        it.vel[i * 3 + 1] -= 2.4 * dt; // light gravity -- sparks hang, not drop
        arr[i * 3] += it.vel[i * 3] * dt;
        arr[i * 3 + 1] += it.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += it.vel[i * 3 + 2] * dt;
      }
      it.points.geometry.attributes.position.needsUpdate = true;
      // Hold full brightness, then fade -- a linear fade from the first frame
      // reads as a puff of smoke rather than a firework.
      const age = 1 - it.life / CFG.blastLife;
      it.points.material.opacity =
        age < HOLD ? 1 : Math.max(0, 1 - (age - HOLD) / (1 - HOLD));
      if (it.life <= 0) it.points.visible = false;
    }
  }

  // The blast spheres still hot enough to set something off. The radius opens
  // over the first fraction of a second so a target has to actually be caught
  // by the expanding shell rather than teleported into by a full-size sphere.
  forEachLethal(fn) {
    if (CFG.blastLethal <= 0) return;   // chaining switched off entirely
    const cut = CFG.blastLife * (1 - CFG.blastLethal);
    for (const it of this.items) {
      if (it.life <= cut) continue;
      const age = CFG.blastLife - it.life;
      fn(it.center, CFG.blastRadius * Math.min(1, age / 0.15), it.owner);
    }
  }
}

// --------------------------------------------------------------- manager
// Everything that can be in the field. The index is the kind code carried in a
// co-op snapshot, so append to this list -- never reorder it mid-session.
//
//   shape    'rock' (icosahedron) or 'gem' (octahedron with a ring). Powerups
//            get their own silhouette so they read as "grab this" even when
//            their colour matches something behind them -- yellow is the sun,
//            purple is the far ridgeline.
//   lands    reaching the ground costs `shields`
//   powerup  flies past rather than falling, and is never caught by shrapnel
export const KINDS = [
  { name: 'meteor',  shape: 'rock', wire: PALETTE.target, core: PALETTE.targetCore, hp: 1, lands: true, shields: 1, scale: 1 },
  { name: 'health',  shape: 'gem',  wire: 0x39ff14, powerup: true },
  { name: 'rapid',   shape: 'gem',  wire: 0xff6b00, powerup: true, weapon: 'rapid' },
  { name: 'shotgun', shape: 'gem',  wire: 0xb026ff, powerup: true, weapon: 'shotgun' },
  { name: 'orb',     shape: 'gem',  wire: 0xffd319, powerup: true, weapon: 'orb' },
  // Thrown by the sun boss: heavier, two-tone, and they cost more when they land.
  { name: 'ember',   shape: 'rock', wire: 0xff6b00, core: 0x000000, hp: 3, lands: true, shields: 2, scale: 1.55 },
  { name: 'flare',   shape: 'rock', wire: 0xff2975, core: 0xff6b00, hp: 3, lands: true, shields: 2, scale: 1.55 },
];
export const KIND = Object.fromEntries(KINDS.map((k, i) => [k.name, i]));

const GEM_R = 0.5;
const GEM_WIRE = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(GEM_R, 0));
const GEM_CORE = new THREE.OctahedronGeometry(GEM_R * 0.45, 0);
const GEM_RING = new THREE.TorusGeometry(GEM_R * 1.25, 0.03, 6, 28);

function makeGem() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(GEM_CORE, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const wire = new THREE.LineSegments(GEM_WIRE, new THREE.LineBasicMaterial({ color: 0xffffff }));
  const ring = new THREE.Mesh(
    GEM_RING,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.rotation.x = Math.PI / 2;
  // Same child order as a rock -- [core, wire] -- so the flash code that reaches
  // for children[1] works on either shape.
  g.add(core, wire, ring);
  return g;
}

// Meteors do not blink into existence: they start as a speck and grow over
// their first moments, which reads as something falling toward you out of
// the sky rather than appearing overhead.
const GROW = 1.3;
const growEase = (x) => 1 - Math.pow(1 - x, 3);

const randSpin = () =>
  new THREE.Vector3((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5);

export class TargetField {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.active = [];
    this.pools = { rock: [], gem: [] };
    this.explosions = new ExplosionPool(scene);
    this.spawnTimer = 0;
    this.spawnScale = 1;     // the boss turns this down so the sky is not soup
    this.nextId = 0;
    this.byId = new Map();
  }

  _acquire(kind = KIND.meteor) {
    const k = KINDS[kind];
    let t = this.pools[k.shape].pop();
    if (!t) {
      t = {
        obj: k.shape === 'gem' ? makeGem() : makeBody(PALETTE.target),
        shape: k.shape,
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        hp: 1, color: 0, flash: 0, id: 0, kind: 0, radius: CFG.targetRadius, age: 0,
      };
      t.obj.userData.target = t;
      this.group.add(t.obj);
    }
    t.kind = kind;
    t.color = k.wire;
    t.hp = k.hp || 1;
    t.flash = 0;
    t.age = 0;
    const scale = k.scale || 1;
    t.radius = k.shape === 'gem' ? GEM_R * 1.1 : CFG.targetRadius * scale;
    t.obj.scale.setScalar(scale);
    t.obj.children[1].material.color.set(C(k.wire));
    t.obj.children[0].material.color.set(
      C(k.shape === 'gem' ? k.wire : k.core != null ? k.core : PALETTE.targetCore)
    );
    if (k.shape === 'gem') t.obj.children[2].material.color.set(C(k.wire));
    t.obj.visible = true;
    return t;
  }

  // Ids are assigned by whoever owns the target, never minted inside _acquire.
  // The host mints them; a client adopts the host's. Minting locally on a
  // client would collide with host ids -- the same number would be written
  // twice, one target would be evicted from the index, and it would then be
  // unkillable and duplicated on screen.
  _register(t, id) {
    t.id = id;
    this.byId.set(id, t);
    return t;
  }

  _release(t) {
    t.obj.visible = false;
    this.byId.delete(t.id);
    const i = this.active.indexOf(t);
    if (i >= 0) this.active.splice(i, 1);
    this.pools[t.shape].push(t);
  }

  // Put any kind anywhere, moving in a straight line. The meteor spawner, the
  // powerup spawner and the boss's throws all end up here.
  spawnAt(kind, position, velocity) {
    const t = this._register(this._acquire(kind), ++this.nextId);
    t.obj.position.copy(position);
    t.vel.copy(velocity);
    t.spin.copy(randSpin());
    this.active.push(t);
    return t;
  }

  spawn(elapsed) {
    // Bearing is drawn from CFG.spawnArc, centred on -Z (the player's start
    // facing). At the default full circle that means anywhere around you.
    const a = -Math.PI / 2 + (Math.random() - 0.5) * CFG.spawnArc;
    const r = 2.5 + Math.random() * (CFG.spawnRadius - 2.5);
    return this.spawnAt(
      KIND.meteor,
      new THREE.Vector3(Math.cos(a) * r, CFG.spawnHeight, Math.sin(a) * r),
      new THREE.Vector3(0, -fallSpeedAt(elapsed), 0)
    );
  }

  // Powerups come at you along the road, as if you are driving past them:
  // out of the horizon, past your shoulder, gone. Missing one costs nothing
  // but the powerup.
  spawnPowerup(kind) {
    const side = Math.random() < 0.5 ? -1 : 1;
    return this.spawnAt(
      kind,
      new THREE.Vector3(side * (2.2 + Math.random() * 4.5), 1.3 + Math.random() * 2.2, CFG.powerupStartZ),
      new THREE.Vector3(0, 0, CFG.powerupSpeed)
    );
  }

  // Runs the field forward. Returns what reached the ground this frame and what
  // got caught in someone's blast, so the caller can score them differently.
  // `authoritative` is false on a co-op client: it still moves targets between
  // snapshots so motion is smooth, but it must not decide that anything landed
  // or detonated -- the host owns that, and a client deciding for itself would
  // disagree and then be corrected, which looks like targets flickering.
  update(dt, elapsed, spawning, authoritative = true) {
    this.explosions.update(dt);

    // A zero spawn scale has to mean zero. Scaling the timer alone is not enough:
    // a timer that was already due when the boss arrived would still fire once.
    if (spawning && this.spawnScale > 0) {
      this.spawnTimer -= dt * this.spawnScale;
      if (this.spawnTimer <= 0) {
        this.spawn(elapsed);
        const difficulty = Math.min(1, elapsed / CFG.rampSeconds);
        const interval = CFG.spawnStart + (CFG.spawnMin - CFG.spawnStart) * difficulty;
        this.spawnTimer = interval * (0.75 + Math.random() * 0.5);
      }
    }

    const landed = [];
    for (let i = this.active.length - 1; i >= 0; i--) {
      const t = this.active[i];
      const k = KINDS[t.kind];
      t.age += dt;
      t.obj.position.addScaledVector(t.vel, dt);

      if (t.shape === 'gem') {
        // Spin on one axis and breathe, so a powerup never looks like debris.
        t.obj.rotation.y += 2.2 * dt;
        const s = 1 + Math.sin(t.age * 6) * 0.12;
        t.obj.scale.setScalar(s);
        t.obj.children[2].rotation.z += 3 * dt;
      } else {
        if (t.age < GROW + dt && !CFG.classic) {
          const g = growEase(Math.min(1, t.age / GROW));
          t.obj.scale.setScalar((k.scale || 1) * (0.06 + 0.94 * g));
        }
        t.obj.rotation.x += t.spin.x * dt;
        t.obj.rotation.y += t.spin.y * dt;
        t.obj.rotation.z += t.spin.z * dt;
      }

      if (t.flash > 0) {
        t.flash -= dt;
        if (t.flash <= 0) t.obj.children[1].material.color.set(C(t.color));
      }

      if (!authoritative) continue;
      if (k.lands && t.obj.position.y <= t.radius) {
        landed.push(t);
        // Nobody's shot, so nobody's blast: the shrapnel still takes out what
        // is falling beside it -- a little mercy for the shield it just cost --
        // but an owner of null is what tells the host not to pay for it.
        this.explosions.burst(t.obj.position, null, null);
        this._release(t);
      } else if (k.powerup && t.obj.position.z > CFG.powerupEndZ) {
        this._release(t);   // drove past it
      }
    }

    if (!authoritative) return { landed, chained: [] };

    // Shrapnel. Gather first, detonate after: destroying inside the sweep would
    // recycle a burst out from under the loop that is reading it. Powerups are
    // exempt -- a cascade that ate the health pack you were lining up would
    // feel like the game cheating.
    const caught = [];
    this.explosions.forEachLethal((center, radius, owner) => {
      for (const t of this.active) {
        if (KINDS[t.kind].powerup || caught.indexOf(t) >= 0) continue;
        if (t.obj.position.distanceTo(center) <= radius + t.radius) {
          t.caughtBy = owner;   // whoever's blast this was gets paid for it
          caught.push(t);
        }
      }
    });
    // Each of these lays down its own blast, so the next frame can carry the
    // cascade further. It terminates on its own: a target that dies leaves
    // this.active immediately, and one that survives has taken damage.
    const chained = [];
    for (const t of caught) {
      if (this.damage(t, CFG.blastDamage, t.caughtBy)) chained.push(t);
    }

    return { landed, chained };
  }

  // Returns true if this killed it. A target that survives flashes white --
  // without that, a shot that connects but does not kill is indistinguishable
  // from a miss, and the player concludes their aim is broken.
  damage(t, amount = 1, killer = null) {
    if (t.hp <= 0) return false;   // already dying this frame
    t.hp -= amount;
    if (t.hp > 0) {
      this._flash(t);
      return false;
    }
    this.destroy(t, killer);
    return true;
  }

  _flash(t) {
    t.flash = FLASH_TIME;
    t.obj.children[1].material.color.set(WHITE);
  }

  destroy(t, killer = null) {
    t.killer = killer;
    const k = KINDS[t.kind];
    // A powerup pops in its own colour rather than a spray of random neons, so
    // you can see what you just picked up.
    this.explosions.burst(t.obj.position, k.powerup ? k.wire : null, killer);
    this._release(t);
  }

  // --- co-op ------------------------------------------------------------
  // Everything travels in a straight line at constant speed, so a snapshot only
  // carries position and velocity: the client integrates between snapshots and
  // lands within a pixel of the host. 20Hz is plenty, with no interpolation.
  //   [id, kind, x, y, z, vx, vy, vz, hp]
  snapshot() {
    const out = [];
    const r = (v) => Math.round(v * 100) / 100;
    for (const t of this.active) {
      const p = t.obj.position;
      out.push([t.id, t.kind, r(p.x), r(p.y), r(p.z), r(t.vel.x), r(t.vel.y), r(t.vel.z), t.hp]);
    }
    return out;
  }

  // Client side: make the local field match the host's. Anything the host no
  // longer lists has died there, so it dies here too.
  applySnapshot(rows, { silent = false } = {}) {
    const seen = new Set();
    for (const [id, kind, x, y, z, vx, vy, vz, hp] of rows) {
      seen.add(id);
      // Keep the local counter ahead of every id the host has used. Without
      // this a client promoted to host starts minting at 1 and collides with
      // targets still falling -- the exact failure _register warns about.
      if (id > this.nextId) this.nextId = id;
      let t = this.byId.get(id);
      if (!t) {
        t = this._register(this._acquire(kind), id);
        t.spin.copy(randSpin());
        this.active.push(t);
      } else if (hp < t.hp) {
        // Somebody hit it and it lived. Derive the flash from the drop in hit
        // points, so clients see a hit land without any extra message.
        this._flash(t);
      }
      t.obj.position.set(x, y, z);
      t.vel.set(vx, vy, vz);
      t.hp = hp;
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const t = this.active[i];
      if (seen.has(t.id)) continue;
      // Gone from the host's world means it ended there -- shot, landed, or
      // driven past. Burst it here rather than having the host send explosion
      // events; the snapshot already carries the information. Except on a phase
      // change, where the host cleared the whole field at once, and for a
      // powerup that simply went past the player, which should not explode.
      const k = KINDS[t.kind];
      const drovePast = k.powerup && t.obj.position.z > CFG.powerupEndZ - 1;
      if (!silent && !drovePast) this.explosions.burst(t.obj.position, k.powerup ? k.wire : null);
      this._release(t);
    }
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this._release(this.active[i]);
  }
}
