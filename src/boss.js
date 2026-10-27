import * as THREE from '../vendor/three.module.js';
import { CFG } from './config.js';
import { KIND } from './targets.js';
import { LEVELS, wedgeCentroid } from './scenery.js';
import { NOVA } from './supernova.js';
import { makePulsar, makeNebula } from './stellar.js';

// The life of a star, told across a whole run.
//
// The boss is not one fight. It is three encounters, each picking up where the
// last one left off, with ordinary meteor stretches in between -- so the pacing
// of a run stays the same while the sky tells a story:
//
//   1. THE SUN        rises, fights, collapses, goes supernova, becomes a black
//                     hole -- and breaks into three shards that stay hanging in
//                     the sky, glowing along their cracks, while meteors return.
//
//   2. THE PULSARS    the shards tremble and each collapses into a pulsar, its
//                     lighthouse beams sweeping the sky. Three mini-bosses. Their
//                     remains drift together into a nebula, which hangs there
//                     through the next stretch of meteors.
//
//   3. THE NEBULA     it stirs and becomes the boss. Damage makes it contract --
//                     you are gravity, sped up -- until it collapses to a point,
//                     the world goes black, light breaks in a new colour, and a
//                     new sun rises. Then the cycle begins again.
//
// The host runs the timeline and owns hit points. A client mirrors stage, phase,
// clock and hit points from the snapshot and animates between them; every phase
// is a function of (phase, t), so there is nothing to interpolate.

const PHASES = [
  'none', 'rising', 'fight', 'dying', 'breaking',
  'igniting', 'pulsars', 'gathering',
  'stirring', 'nebula', 'dark', 'dawn',
];
const CODE = Object.fromEntries(PHASES.map((p, i) => [p, i]));

const TAU = Math.PI * 2;
const SUN_R = 44;
const EMERGE = 2.2;     // shards streaking out of the black hole to their places
const IGNITE = 2.8;     // shards trembling and collapsing into pulsars
const GATHER = 3.6;     // pulsar remains drifting together into a nebula
const STIR = 2.6;       // the nebula waking up
const COLLAPSE = 1.5;   // the nebula falling in on itself, at the start of the dark
const GRACE = 1.6;      // let the last pulsar's explosion play out

const SUN = 0, PULSARS = 1, NEBULA = 2;

const ease = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Scratch for the per-frame poses, so a boss fight does not feed the garbage
// collector (a collection is a visible hitch on a Quest).
const _arcV = new THREE.Vector3();
const _throwV = new THREE.Vector3();
const EYE = new THREE.Vector3(0, 1.6, 0);
// Phases where the sun has broken and is not on the horizon at all.
const SUN_HIDDEN = new Set(['breaking', 'igniting', 'pulsars', 'gathering', 'stirring', 'nebula', 'dark']);

export class SunBoss {
  // hooks: rise(), omen(), collapse(), nova(pos, killer), shardNova(pos, killer), birth(pos)
  // fx:    the big supernova, for the whole sun
  // minis: small novas, one per pulsar
  // world: { scene, camera }
  constructor(scenery, targets, hooks, fx, minis, world) {
    this.scenery = scenery;
    this.targets = targets;
    this.hooks = hooks;
    this.fx = fx;
    this.minis = minis || [];
    this.world = world;
    this.clock = 0;
    this.shards = [];
    this.pulsars = [];
    this.nebula = null;
    this.puffs = [];
    this.reset();
  }

  reset() {
    this._clearShards();
    this._clearPulsars();
    this._clearNebula();
    this.stage = SUN;
    this.phase = 'none';
    this.t = 0;
    this.level = 0;
    this.hp = 0;
    this.hpMax = 1;
    this.flash = 0;
    this.throwIn = 0;
    this.waitFor = CFG.bossFirst;
    this.killer = null;
    this.novaFired = false;
    this.shardRot = 0;
    this.allDeadAt = null;
    this.deathAt = new THREE.Vector3(0, CFG.bossY, CFG.bossZ);
    this.deathRadius = SUN_R * CFG.bossScale;
    this.deathLevel = 0;
    this.scenery.applyLevel(0);
    this.scenery.setWorldDark(0);
    if (this.fx) this.fx.hide();
    for (const m of this.minis) m.hide();
    this._pose();
  }

  get palette() {
    return LEVELS[Math.min(this.level, LEVELS.length - 1)];
  }

  // Anything but a quiet stretch between encounters. Normal meteors stop.
  get active() {
    return this.phase !== 'none';
  }

  get hittable() {
    return this.phase === 'fight' || this.phase === 'pulsars' || this.phase === 'nebula';
  }

  _enter(phase) {
    const was = this.phase;
    this.phase = phase;
    this.t = 0;
    if (phase === was) return;
    // Visuals and sound fire on the transition, so a client that only ever sees
    // the phase change in a snapshot gets the same show as the host.
    if (phase === 'rising' && this.hooks.rise) this.hooks.rise();
    if ((phase === 'igniting' || phase === 'stirring') && this.hooks.omen) this.hooks.omen();
    if (phase === 'dying') {
      this.deathAt = this.scenery.sunPosition().clone();
      this.deathRadius = this.radius;
      this.deathLevel = this.level;
      this.novaFired = false;
      if (this.hooks.collapse) this.hooks.collapse();
    }
    if (phase === 'dark' && this.hooks.birth) this.hooks.birth(this.nebulaCenter.clone());
    if (phase !== 'dying' && this.fx) this.fx.hide();
  }

  // --- where things hang in the sky ---------------------------------------------
  // Derived from where the sun died and the angle it broke along, so every
  // machine puts the shards, the pulsars and the nebula in the same places.
  _stations() {
    // Spread round the whole sky, a third of a turn apart, starting from the
    // direction the sun died in. Heights vary a little so they never line up.
    const count = CFG.shardCount;
    const out = [];
    const az0 = Math.atan2(this.deathAt.x, -this.deathAt.z);
    for (let i = 0; i < count; i++) {
      const az = az0 + (i * TAU) / count;
      const el = CFG.shardElevation + Math.sin(this.shardRot * 3 + i * 2.4) * 0.1;
      const r = CFG.shardDistance;
      out.push(new THREE.Vector3(
        Math.sin(az) * Math.cos(el) * r,
        1.6 + Math.sin(el) * r,
        -Math.cos(az) * Math.cos(el) * r
      ));
    }
    return out;
  }

  // A path that arcs up through the sky rather than cutting a straight line
  // past the players.
  // Shared scratch: copy it out before the next call.
  _arc(from, to, k) {
    _arcV.copy(from).lerp(to, k);
    _arcV.y += Math.sin(k * Math.PI) * 18;
    return _arcV;
  }

  // Pulsars can hang behind the players, so the flat screen's edge arrows
  // point at them too.
  // Asked every frame; the list and its entries are reused.
  cueTargets() {
    const out = this._cues || (this._cues = []);
    out.length = 0;
    if (this.phase !== 'pulsars') return out;
    this.pulsars.forEach((p, i) => {
      if (!p.alive) return;
      this._pulsarPos(p, i);
      out.push(p.cue || (p.cue = { obj: { position: p.pos }, color: 0xffffff }));
    });
    return out;
  }

  // Where the sun died, a little higher, pushed well out into the sky. Only
  // moves when deathAt does, so it is worked out once per death and kept --
  // read it, never change it.
  get nebulaCenter() {
    const at = this.deathAt;
    if (!this._nebFor || !this._nebFor.equals(at)) {
      this._nebFor = (this._nebFor || new THREE.Vector3()).copy(at);
      const c = this._nebCenter || (this._nebCenter = new THREE.Vector3());
      c.copy(at);
      c.y += 12;
      c.sub(EYE).normalize().multiplyScalar(CFG.nebulaDistance).add(EYE);
    }
    return this._nebCenter;
  }

  // --- shards ----------------------------------------------------------------
  get shardScale() {
    return CFG.bossScale * CFG.shardScale;
  }

  _buildShards() {
    this._clearShards();
    const count = CFG.shardCount;
    const span = TAU / count;
    const stations = this._stations();
    for (let i = 0; i < count; i++) {
      const a0 = this.shardRot + i * span;
      const mesh = this.scenery.createShard(a0, span, i * 3.7 + this.shardRot * 5, this.level);
      this.shards.push({ mesh, a0, span, station: stations[i], centroid: wedgeCentroid(span) * SUN_R });
    }
  }

  _clearShards() {
    for (const s of this.shards) this.scenery.disposeShard(s.mesh);
    this.shards = [];
  }

  // --- pulsars ---------------------------------------------------------------
  _buildPulsars() {
    this._clearPulsars();
    const stations = this._stations();
    const hpMax = Math.max(1, Math.round(this.hpMax * CFG.shardHpFraction));
    stations.forEach((station, i) => {
      this.pulsars.push({
        fx: makePulsar(this.world.scene, i + 1 + this.shardRot),
        station, pos: new THREE.Vector3(), hp: hpMax, hpMax, alive: true, deathT: null, flash: 0,
        throwIn: 1.4 + i * 1.1,
      });
    });
  }

  _clearPulsars() {
    for (const p of this.pulsars) p.fx.dispose();
    this.pulsars = [];
    for (const m of this.minis) m.hide();
  }

  // Kept on the pulsar (p.pos) and refreshed on every call.
  _pulsarPos(p, i) {
    p.pos.copy(p.station);
    p.pos.y += Math.sin(this.clock * 0.8 + i * 2.1) * 1.1;
    return p.pos;
  }

  _pulsarDies(p, killer) {
    p.alive = false;
    p.hp = 0;
    p.deathT = this.clock;
    const i = this.pulsars.indexOf(p);
    if (this.hooks.shardNova) this.hooks.shardNova(this._pulsarPos(p, i).clone(), killer);
  }

  // --- nebula ----------------------------------------------------------------
  _buildNebula() {
    this._clearNebula();
    this.nebula = {
      fx: makeNebula(this.world.scene, 3.1 + this.shardRot),
      hp: 1, hpMax: 1, flash: 0, throwIn: 2,
    };
    this.puffs = this._stations().map((station, i) => ({
      fx: makeNebula(this.world.scene, 7 + i * 5.3),
      station,
    }));
  }

  _clearNebula() {
    if (this.nebula) this.nebula.fx.dispose();
    this.nebula = null;
    this._clearPuffs();
  }

  _clearPuffs() {
    for (const p of this.puffs) p.fx.dispose();
    this.puffs = [];
  }

  get nebulaSize() {
    if (!this.nebula) return 0;
    return CFG.nebulaSize * (1 - 0.4 * (1 - this.nebula.hp / this.nebula.hpMax));
  }

  // --- host ----------------------------------------------------------------
  hostUpdate(dt) {
    this.t += dt;
    this.clock += dt;
    const baseHp = CFG.bossHp + CFG.bossHpPerLevel * this.level;

    switch (this.phase) {
      case 'none':
        this.waitFor -= dt;
        if (this.waitFor > 0) break;
        if (this.stage === SUN) {
          this.hpMax = baseHp;
          this.hp = baseHp;
          this._enter('rising');
        } else if (this.stage === PULSARS) {
          this.hpMax = baseHp;
          this._buildPulsars();
          this._enter('igniting');
        } else {
          if (!this.nebula) this._buildNebula();
          this._clearPuffs();
          this.nebula.hpMax = Math.max(1, Math.round(baseHp * CFG.nebulaHpFraction));
          this.nebula.hp = this.nebula.hpMax;
          this._enter('stirring');
        }
        break;

      // --- 1. the sun
      case 'rising':
        if (this.t >= CFG.bossRise) {
          this.throwIn = 1.2;
          this._enter('fight');
        }
        break;
      case 'fight':
        this.throwIn -= dt;
        if (this.throwIn <= 0) {
          this._throw(this.scenery.sunPosition(), 3, this.radius * 0.35);
          this.throwIn = Math.max(1.2, CFG.bossThrowEvery - this.level * 0.3);
        }
        break;
      case 'dying':
        if (this.t >= NOVA.end) {
          this.shardRot = Math.random() * TAU;
          this._buildShards();
          this._enter('breaking');
        }
        break;
      case 'breaking':
        if (this.t >= EMERGE) this._interlude(PULSARS);
        break;

      // --- 2. the pulsars
      case 'igniting':
        if (this.t >= IGNITE) {
          this._clearShards();
          this.allDeadAt = null;
          this._enter('pulsars');
        }
        break;
      case 'pulsars':
        this.pulsars.forEach((p, i) => {
          if (!p.alive) return;
          p.throwIn -= dt;
          if (p.throwIn <= 0) {
            this._throw(this._pulsarPos(p, i), 1, 2);
            p.throwIn = CFG.shardThrowEvery;
          }
        });
        if (this.pulsars.length && this.pulsars.every((p) => !p.alive)) {
          if (this.allDeadAt == null) this.allDeadAt = this.t;
          if (this.t - this.allDeadAt >= GRACE) {
            this._buildNebula();
            this._enter('gathering');
          }
        }
        break;
      case 'gathering':
        if (this.t >= GATHER) {
          this._clearPulsars();
          this._clearPuffs();
          this._interlude(NEBULA);
        }
        break;

      // --- 3. the nebula
      case 'stirring':
        if (this.t >= STIR) {
          this.nebula.throwIn = 1.5;
          this._enter('nebula');
        }
        break;
      case 'nebula':
        this.nebula.throwIn -= dt;
        if (this.nebula.throwIn <= 0) {
          const c = this.nebulaCenter;
          const r = this.nebulaSize * 0.35;
          const from = _throwV.set((Math.random() - 0.5) * r, (Math.random() - 0.5) * r, 0).add(c);
          this._throw(from, 2, 0);
          this.nebula.throwIn = CFG.nebulaThrowEvery;
        }
        break;
      case 'dark':
        if (this.nebula && this.t >= COLLAPSE) this._clearNebula();
        // The new colour is chosen while everything is black, so dawn can reveal
        // it rather than it appearing.
        if (this.t >= CFG.bossDark) {
          this.level++;
          this.scenery.applyLevel(this.level);
          this._enter('dawn');
        }
        break;
      case 'dawn':
        if (this.t >= CFG.bossDawn) this._interlude(SUN);
        break;
    }
    this._pose(dt);
  }

  _interlude(nextStage) {
    this.stage = nextStage;
    this.waitFor = CFG.bossEvery;
    this._enter('none');
  }

  // Aimed at the ground around the players, in straight lines.
  _throw(fromPos, count, drop) {
    const from = fromPos.clone();
    from.y -= drop;
    for (let i = 0; i < count; i++) {
      const aim = new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
      // Faster from further away, so a meteor from a distant pulsar takes about
      // as long to arrive as one from the sun.
      const reach = Math.max(1, from.length() / 60);
      const vel = aim.sub(from).normalize().multiplyScalar((CFG.bossThrowSpeed + this.level * 0.6) * reach);
      const start = from.clone().add(new THREE.Vector3((i - (count - 1) / 2) * 3, (Math.random() - 0.5) * 2, 0));
      this.targets.spawnAt((i + this.level) % 2 ? KIND.flare : KIND.ember, start, vel);
    }
  }

  // Returns the points a kill is worth, or 0 if nothing died.
  damage(amount, killer, piece = -1) {
    if (this.phase === 'fight') {
      if (this.hp <= 0) return 0;
      this.hp -= amount;
      this.flash = 1;
      if (this.hp > 0) return 0;
      this.hp = 0;
      this.killer = killer;
      this._enter('dying');
      return CFG.bossPoints;
    }
    if (this.phase === 'pulsars') {
      const p = this.pulsars[piece];
      if (!p || !p.alive) return 0;
      p.hp -= amount;
      p.flash = 1;
      if (p.hp > 0) return 0;
      this._pulsarDies(p, killer);
      return CFG.shardPoints;
    }
    if (this.phase === 'nebula' && this.nebula) {
      if (this.nebula.hp <= 0) return 0;
      this.nebula.hp -= amount;
      this.nebula.flash = 1;
      if (this.nebula.hp > 0) return 0;
      this.nebula.hp = 0;
      this._enter('dark');
      return CFG.nebulaPoints;
    }
    return 0;
  }

  // --- everyone ------------------------------------------------------------
  _pose(dt = 0) {
    const L = this.palette;
    const cam = this.world && this.world.camera;

    // --- the world's light
    let darkness = 0;
    if (this.phase === 'dark') darkness = ease(clamp01(this.t / 1.8));
    if (this.phase === 'dawn') darkness = 1 - ease(clamp01(this.t / (CFG.bossDawn * 0.75)));
    this.scenery.setWorldDark(darkness);

    this._poseSun(dt);

    // --- shards: flying out, hanging through the interlude, trembling into pulsars
    const shardsShown = this.phase === 'breaking' || this.phase === 'igniting' ||
      (this.phase === 'none' && this.stage === PULSARS);
    if (shardsShown && !this.shards.length) this._buildShards();
    this.shards.forEach((sh, i) => {
      const m = sh.mesh;
      if (!shardsShown) {
        m.visible = false;
        return;
      }
      let e = 1;
      let scale = this.shardScale;
      let shake = 0;
      let glow = 0;
      if (this.phase === 'breaking') e = ease(clamp01(this.t / EMERGE));
      if (this.phase === 'igniting') {
        const k = this.t / IGNITE;
        shake = k * 1.6;
        glow = Math.min(1, k * 1.4);
        // The last stretch of the tremble: it falls in on itself.
        scale *= 1 - ease(clamp01((k - 0.62) / 0.38));
      }
      m.visible = scale * e > 0.001;
      m.position.copy(this._arc(this.deathAt, sh.station, e));
      m.position.y += Math.sin(this.clock * 0.8 + i * 2.1) * 1.1 * e;
      m.position.x += (Math.random() - 0.5) * shake;
      m.position.y += (Math.random() - 0.5) * shake;
      // Face the players wherever it hangs -- a shard behind you would
      // otherwise show you its back, which does not draw at all.
      m.lookAt(0, 1.6, 0);
      m.rotateZ(Math.sin(this.clock * 0.5 + i) * 0.18);
      m.scale.setScalar(Math.max(0.0001, scale * e));
      const u = m.material.uniforms;
      u.uTime.value = this.clock % 600;
      u.uHealth.value = 1;
      u.uFlash.value = glow * (0.4 + 0.3 * Math.sin(this.clock * 30));
    });

    // --- pulsars
    const pulsarsShown = this.phase === 'igniting' || this.phase === 'pulsars';
    if (pulsarsShown && !this.pulsars.length) this._buildPulsars();
    this.pulsars.forEach((p, i) => {
      const pos = this._pulsarPos(p, i);
      let alpha = 0;
      let beams = 0;
      let size = CFG.pulsarSize;
      if (this.phase === 'igniting') {
        const k = this.t / IGNITE;
        alpha = ease(clamp01((k - 0.6) / 0.4));
        beams = ease(clamp01((k - 0.85) / 0.15));
        size *= 0.4 + 0.6 * alpha;
      } else if (this.phase === 'pulsars' && p.alive) {
        alpha = 1;
        beams = 1;
      }
      p.flash = Math.max(0, p.flash - dt * 6);
      if (cam) p.fx.update(pos, this.clock, cam, L, alpha, p.hp / p.hpMax, p.flash, beams, size);
      if (!p.alive && p.deathT != null && this.minis[i]) {
        this.minis[i].update(this.clock - p.deathT + NOVA.collapse, pos, 7, L, this.clock);
      }
    });

    // --- the nebula: gathering, hanging, stirring, fighting, collapsing
    const nebulaShown = this.phase === 'gathering' || this.phase === 'stirring' ||
      this.phase === 'nebula' || (this.phase === 'dark' && this.t < COLLAPSE) ||
      (this.phase === 'none' && this.stage === NEBULA);
    if (nebulaShown && !this.nebula) this._buildNebula();
    if (this.nebula && cam) {
      const n = this.nebula;
      n.flash = Math.max(0, n.flash - dt * 4);
      const center = this.nebulaCenter;
      let alpha = nebulaShown ? 1 : 0;
      let size = this.nebulaSize || CFG.nebulaSize;
      let contract = 0;
      let swirl = 0.35;
      let flash = n.flash * 0.5;
      if (this.phase === 'gathering') {
        const k = ease(clamp01(this.t / GATHER));
        alpha = k;
        size = CFG.nebulaSize * (0.3 + 0.7 * k);
        this.puffs.forEach((pf) => {
          const pos = this._arc(pf.station, center, k);
          pf.fx.update(pos, 12 + 6 * k, this.clock, cam, L, 1 - k * k, 0, 1.5, 0);
        });
      } else {
        for (const pf of this.puffs) pf.fx.update(center, 1, this.clock, cam, L, 0, 0, 0, 0);
      }
      if (this.phase === 'stirring') {
        const k = this.t / STIR;
        swirl = 0.35 + 2.2 * ease(clamp01(k));
        flash = 0.25 * Math.max(0, Math.sin(this.clock * 14)) * k;
      }
      if (this.phase === 'nebula') {
        contract = 1 - n.hp / n.hpMax;
        swirl = 2.6 + contract * 3;
      }
      if (this.phase === 'dark') {
        // Falling in on itself, then gone: the new star is being born.
        const k = clamp01(this.t / COLLAPSE);
        contract = 1;
        size = CFG.nebulaSize * 0.45 * (1 - ease(k));
        swirl = 8;
        flash = Math.sin(k * Math.PI);
      }
      n.fx.update(center, Math.max(0.01, size), this.clock, cam, L, alpha, contract, swirl, flash);
    }
  }

  _poseSun(dt) {
    const H = this.scenery.sunHome;
    const nearY = CFG.bossY, nearZ = CFG.bossZ, nearS = CFG.bossScale;
    let k = 0;
    if (this.phase === 'rising') k = ease(Math.min(1, this.t / CFG.bossRise));
    if (this.phase === 'fight' || this.phase === 'dying') k = 1;
    let y = H.y + (nearY - H.y) * k;
    let z = H.z + (nearZ - H.z) * k;
    let s = 1 + (nearS - 1) * k;
    let health = 1;
    let flare = k * 1.3;

    if (this.phase === 'fight') y += Math.sin(this.t * 0.9) * 1.2;
    if (this.phase === 'fight' || this.phase === 'dying') health = Math.max(0, this.hp / this.hpMax);
    if (this.phase === 'dying') {
      const c = Math.min(1, this.t / NOVA.collapse);
      s *= this.t < NOVA.collapse ? 1 - 0.9 * c * c * c : 0.0001;
      if (this.t < NOVA.collapse) y += (Math.random() - 0.5) * 3 * c;
      flare = this.t < NOVA.collapse ? 2.4 * (1 - c) : 0;
    }
    // The sun is only on the horizon while it is the sun. Once it has broken,
    // the sky belongs to what it became.
    const sunGone = this.stage !== SUN && this.phase === 'none';
    if (sunGone || SUN_HIDDEN.has(this.phase)) {
      s = 0.0001;
    }
    if (this.phase === 'dawn') {
      const r = ease(clamp01((this.t - 1.2) / (CFG.bossDawn - 1.2)));
      y = -70 + (H.y + 70) * r;
      z = H.z;
      s = 1;
      health = 0.35 + 0.65 * r;
      flare = 0;
      k = 0;
    }
    this.scenery.setSun(y, z, s, k);
    this.scenery.setSunHealth(health);
    const hurt = this.phase === 'fight' || this.phase === 'dying' ? 1 - health : 0;
    this.scenery.setSunFlare(flare, hurt);

    const dyingWhite = this.phase === 'dying' ? Math.min(1, this.t / NOVA.collapse) : 0;
    this.flash = Math.max(dyingWhite, this.flash - dt * 6);
    this.scenery.setSunFlash(this.flash);

    if (this.phase === 'dying' && !this.novaFired && this.t >= NOVA.collapse) {
      this.novaFired = true;
      if (this.hooks.nova) this.hooks.nova(this.deathAt.clone(), this.killer);
    }
    if (this.fx && this.phase === 'dying') {
      this.fx.update(this.t, this.deathAt, this.deathRadius,
        LEVELS[Math.min(this.deathLevel, LEVELS.length - 1)], this.clock);
    }
  }

  get radius() {
    return this.scenery.sunRadius * this.scenery.sunScale();
  }

  // Where along a ray the boss would be hit: { t, piece } or null. piece is -1
  // for the sun or the nebula, or which pulsar. While it is up there but cannot
  // be hurt yet -- rising, breaking, trembling, gathering, stirring -- a shot
  // still stops on it, as { t, deflect: true }, so it glances off instead of
  // sailing through and players can see they have to wait.
  rayHit(origin, dir, range) {
    if (!this.hittable) return this._deflectHit(origin, dir, range);

    if (this.phase === 'fight') {
      const t = this._sunHit(origin, dir, range);
      return t != null ? { t, piece: -1 } : null;
    }

    if (this.phase === 'pulsars') {
      let best = null;
      this.pulsars.forEach((p, i) => {
        if (!p.alive) return;
        const t = raySphere(origin, dir, this._pulsarPos(p, i), CFG.pulsarHitRadius);
        if (t != null && t <= range && (!best || t < best.t)) best = { t, piece: i };
      });
      return best;
    }

    if (this.phase === 'nebula') {
      const t = raySphere(origin, dir, this.nebulaCenter, this.nebulaSize * 0.3);
      return t != null && t <= range ? { t, piece: -1 } : null;
    }
    return null;
  }

  // The sun's disc faces the players, so it is hit where the ray crosses its plane.
  _sunHit(origin, dir, range) {
    if (dir.z >= -1e-4) return null;
    const c = this.scenery.sunPosition();
    const t = (c.z - origin.z) / dir.z;
    if (t <= 0 || t > range) return null;
    const px = origin.x + dir.x * t - c.x;
    const py = origin.y + dir.y * t - c.y;
    return px * px + py * py > (this.radius * 1.05) ** 2 ? null : t;
  }

  // Everything that hangs in the sky without hit points, as the poses above
  // draw it. Spheres are generous: these are cues, not hitboxes that count.
  _deflectHit(origin, dir, range) {
    const near = (t) => (t != null && t <= range ? { t, piece: -1, deflect: true } : null);

    if (this.phase === 'rising') return near(this._sunHit(origin, dir, range));

    const shardsUp = this.phase === 'breaking' || this.phase === 'igniting' ||
      (this.phase === 'none' && this.stage === PULSARS);
    if (shardsUp) {
      let best = null;
      for (const sh of this.shards) {
        if (!sh.mesh.visible) continue;
        // A third of the disc, about its own middle -- and as it collapses into
        // a pulsar, at least the pulsar's core.
        const r = Math.max(SUN_R * 0.5 * sh.mesh.scale.x,
          this.phase === 'igniting' ? CFG.pulsarHitRadius : 0);
        const t = raySphere(origin, dir, sh.mesh.position, r);
        if (t != null && (best == null || t < best)) best = t;
      }
      return near(best);
    }

    const nebulaUp = this.phase === 'gathering' || this.phase === 'stirring' ||
      (this.phase === 'none' && this.stage === NEBULA);
    if (nebulaUp && this.nebula) {
      const k = this.phase === 'gathering' ? ease(clamp01(this.t / GATHER)) : 1;
      return near(raySphere(origin, dir, this.nebulaCenter, CFG.nebulaSize * (0.3 + 0.7 * k) * 0.3));
    }
    return null;
  }

  update(dt) {
    // Clients advance the clock themselves between snapshots.
    this.t += dt;
    this.clock += dt;
    this._pose(dt);
  }

  // --- co-op ---------------------------------------------------------------
  //   [phase, t, stage, level, hp, hpMax, shardRot, [pulsar hp], nebulaHp, nebulaHpMax,
  //    deathAt x, y, z]
  snapshot() {
    const r = (v) => Math.round(v * 100) / 100;
    return [
      CODE[this.phase], r(this.t), this.stage, this.level, this.hp, this.hpMax,
      Math.round(this.shardRot * 1000) / 1000,
      this.pulsars.map((p) => p.hp),
      this.nebula ? this.nebula.hp : 0, this.nebula ? this.nebula.hpMax : 0,
      r(this.deathAt.x), r(this.deathAt.y), r(this.deathAt.z),
    ];
  }

  apply(row) {
    if (!row) return;
    const [code, t, stage, level, hp, hpMax, rot, pulsarHp, nebHp, nebMax, dx, dy, dz] = row;
    const phase = PHASES[code] || 'none';

    // Where things hang is derived from these, so adopt them before rebuilding.
    if (dx != null) this.deathAt.set(dx, dy, dz);
    if (Math.abs((rot || 0) - this.shardRot) > 1e-3) {
      this.shardRot = rot || 0;
      this._clearShards();
      this._clearPulsars();
    }
    this.stage = stage;
    if (phase !== this.phase) {
      if (phase === 'pulsars' || phase === 'gathering') this._clearShards();
      if (phase === 'none' && stage === SUN) {
        this._clearNebula();
        this._clearPulsars();
      }
      this._enter(phase);
    }
    if (hp < this.hp) this.flash = 1;
    this.t = t;
    this.hp = hp;
    this.hpMax = hpMax;
    if (level !== this.level) {
      this.level = level;
      this.scenery.applyLevel(level);
    }

    if ((phase === 'igniting' || phase === 'pulsars') && !this.pulsars.length) this._buildPulsars();
    (pulsarHp || []).forEach((h, i) => {
      const p = this.pulsars[i];
      if (!p) return;
      if (h < p.hp) p.flash = 1;
      if (p.alive && h <= 0) this._pulsarDies(p, null);
      else if (p.alive) p.hp = h;
      p.hpMax = Math.max(p.hpMax, h);
    });

    if (nebMax) {
      if (!this.nebula) this._buildNebula();
      if (nebHp < this.nebula.hp) this.nebula.flash = 1;
      this.nebula.hp = nebHp;
      this.nebula.hpMax = nebMax;
    }
  }
}

// Distance along a normalised ray to a sphere, or null.
function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
