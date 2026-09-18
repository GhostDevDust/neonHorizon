import * as THREE from '../vendor/three.module.js';
import { SEAT } from './hud.js';

// The other players, drawn as neon outlines standing beside you.
//
// Everyone really stands at the same spot -- the world is built around one
// point -- so drawing a friend where they actually are would put them inside
// your own head. Instead each player has a seat along a line, in the same
// order as the scoreboard columns, and everyone sees everyone else from their
// own seat. If you are P1, P2 stands a step and a half to your right; P2 sees
// you a step and a half to their left.
//
// An outline is only a picture. It is never hit-tested: shots go straight
// through it, and so do meteors.

const GAP = 1.5;       // metres between seats
const SMOOTH = 14;     // how quickly an outline catches up with the last pose
const STALE = 3;       // seconds without a pose before an outline disappears
const ARM = 0.3;       // upper and lower arm, metres

// Where a flat-screen player's blaster sits relative to their head, and where
// its beam leaves it.
const FLAT_GUN = new THREE.Vector3(0.24, -0.32, -0.34);
const MUZZLE = new THREE.Vector3(0, 0.01, -0.2);

function lineMat(color) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
}

function makeGun(mat) {
  const g = new THREE.Group();
  const body = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.05, 0.06, 0.16)), mat);
  body.position.z = -0.04;
  const barrel = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.01, -0.12), new THREE.Vector3(0, 0.01, -0.2)]),
    mat
  );
  const grip = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.03, 0.01), new THREE.Vector3(0, -0.11, 0.04)]),
    mat
  );
  g.add(body, barrel, grip);
  g.visible = false;
  return g;
}

function makeLabel(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const c = canvas.getContext('2d');
  c.font = 'bold 44px monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowColor = color;
  c.shadowBlur = 12;
  c.fillStyle = color;
  c.fillText(text, 64, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false,
  }));
  sprite.scale.set(0.32, 0.16, 1);
  return sprite;
}

// Head, body and blasters for one player.
class Ghost {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.mat = lineMat(0xffffff);

    this.head = new THREE.Group();
    const skull = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.11, 0)), this.mat);
    skull.scale.set(0.85, 1.1, 0.95);
    // A visor across the front, so you can tell which way they are looking.
    const visor = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.08, 0.025, -0.108), new THREE.Vector3(0.08, 0.025, -0.108),
      new THREE.Vector3(0.07, -0.025, -0.104), new THREE.Vector3(-0.07, -0.025, -0.104),
    ]), this.mat);
    this.head.add(skull, visor);

    // Neck, spine, shoulders, hips, two legs and two arms, rebuilt every frame.
    this.bodyGeo = new THREE.BufferGeometry();
    this.bodyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 2 * 3), 3));
    this.body = new THREE.LineSegments(this.bodyGeo, this.mat);
    this.body.frustumCulled = false;

    // guns[0], guns[1]: a VR player's two hands. guns[2]: a flat-screen player's.
    this.guns = [makeGun(this.mat), makeGun(this.mat), makeGun(this.mat)];
    this.label = null;
    this.group.add(this.head, this.body, ...this.guns);
    scene.add(this.group);

    // The last pose received. `seen` is seconds since it arrived; -1 is never.
    this.goal = { head: new THREE.Vector3(0, 1.6, 0), headQ: new THREE.Quaternion(), hands: [null, null] };
    this.seen = -1;
    this.index = -1;
  }

  setSeat(x, index) {
    this.group.position.set(x, 0, 0);
    if (this.index === index) return;
    this.index = index;
    const color = SEAT[index % SEAT.length];
    this.mat.color.set(color);
    if (this.label) {
      this.group.remove(this.label);
      this.label.material.map.dispose();
      this.label.material.dispose();
    }
    this.label = makeLabel(`P${index + 1}`, '#' + new THREE.Color(color).getHexString());
    this.group.add(this.label);
  }

  pose(msg) {
    const h = msg.h;
    if (!h || h.length < 7) return;
    const first = this.seen < 0;
    this.goal.head.set(h[0], h[1], h[2]);
    this.goal.headQ.set(h[3], h[4], h[5], h[6]).normalize();
    for (let i = 0; i < 2; i++) {
      const g = msg.g && msg.g[i];
      const gun = this.guns[i];
      if (g && g.length >= 7) {
        const hand = this.goal.hands[i] || (this.goal.hands[i] = { pos: new THREE.Vector3(), q: new THREE.Quaternion() });
        hand.pos.set(g[0], g[1], g[2]);
        hand.q.set(g[3], g[4], g[5], g[6]).normalize();
        if (!gun.visible) {
          gun.position.copy(hand.pos);
          gun.quaternion.copy(hand.q);
        }
        gun.visible = true;
      } else {
        this.goal.hands[i] = null;
        gun.visible = false;
      }
    }
    if (first) {
      this.head.position.copy(this.goal.head);
      this.head.quaternion.copy(this.goal.headQ);
    }
    this.seen = 0;
  }

  update(dt) {
    if (this.seen < 0) return;
    this.seen += dt;
    this.group.visible = this.seen < STALE;
    if (!this.group.visible) return;

    const k = 1 - Math.exp(-dt * SMOOTH);
    this.head.position.lerp(this.goal.head, k);
    this.head.quaternion.slerp(this.goal.headQ, k);
    const vr = !!(this.goal.hands[0] || this.goal.hands[1]);
    for (let i = 0; i < 2; i++) {
      const goal = this.goal.hands[i];
      if (!goal) continue;
      this.guns[i].position.lerp(goal.pos, k);
      this.guns[i].quaternion.slerp(goal.q, k);
    }
    const flatGun = this.guns[2];
    flatGun.visible = !vr;
    if (!vr) {
      flatGun.position.copy(FLAT_GUN).applyQuaternion(this.head.quaternion).add(this.head.position);
      flatGun.quaternion.copy(this.head.quaternion);
    }

    this._body(vr);
    if (this.label) this.label.position.copy(this.head.position).add(new THREE.Vector3(0, 0.32, 0));
  }

  // A simple figure hung off the head: it turns with the head's heading but
  // stays upright, and scales with eye height so a seated player looks seated.
  _body(vr) {
    const head = this.head.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.head.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const eye = Math.max(0.6, head.y);
    const at = (up, side, ahead = 0) => new THREE.Vector3(head.x, up, head.z)
      .addScaledVector(right, side).addScaledVector(fwd, ahead);

    const chin = new THREE.Vector3(head.x, head.y - 0.14, head.z);
    const neck = at(eye * 0.88, 0);
    const hips = at(eye * 0.56, 0);
    const shL = at(eye * 0.85, -0.2);
    const shR = at(eye * 0.85, 0.2);
    const hipL = at(eye * 0.56, -0.12);
    const hipR = at(eye * 0.56, 0.12);
    const kneeL = at(eye * 0.29, -0.14, 0.05);
    const kneeR = at(eye * 0.29, 0.14, 0.05);
    const footL = at(0, -0.16);
    const footR = at(0, 0.16);

    // Hands: wherever the blasters are, or hanging at the sides.
    const hands = [null, null];   // [left, right]
    if (vr) {
      for (let i = 0; i < 2; i++) {
        if (!this.guns[i].visible) continue;
        const p = this.guns[i].position;
        let side = p.clone().sub(head).dot(right) >= 0 ? 1 : 0;
        if (hands[side]) side = 1 - side;
        hands[side] = p.clone();
      }
    } else {
      hands[1] = this.guns[2].position.clone();
    }
    const arm = (shoulder, hand, sign) => {
      const h = hand
        ? hand.clone()
        : shoulder.clone().addScaledVector(right, sign * 0.05).setY(shoulder.y - ARM * 1.9);
      // Pull an unreachable hand in to arm's length, then bend the elbow down.
      const reach = h.clone().sub(shoulder);
      if (reach.length() > ARM * 2) h.copy(shoulder).addScaledVector(reach.normalize(), ARM * 2);
      const elbow = shoulder.clone().lerp(h, 0.5).add(new THREE.Vector3(0, -0.12, 0)).addScaledVector(right, sign * 0.06);
      return [shoulder, elbow, elbow, h];
    };

    const pts = [
      chin, neck,
      neck, hips,
      shL, shR,
      hipL, hipR,
      hipL, kneeL, kneeL, footL,
      hipR, kneeR, kneeR, footR,
      ...arm(shL, hands[0], -1),
      ...arm(shR, hands[1], 1),
    ];
    const a = this.bodyGeo.attributes.position;
    for (let i = 0; i < pts.length; i++) a.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    a.needsUpdate = true;
  }

  // World position a shot from this player's `hand` should start at: -1 is a
  // flat-screen player's blaster, 0 and 1 are a VR player's hands.
  muzzle(hand) {
    let gun = hand >= 0 && this.guns[hand] && this.guns[hand].visible ? this.guns[hand] : null;
    if (!gun) gun = this.guns.find((g) => g.visible);
    if (!gun || this.seen < 0) {
      return this.group.position.clone().add(new THREE.Vector3(0.2, 1.3, -0.3));
    }
    return MUZZLE.clone().applyQuaternion(gun.quaternion).add(gun.position).add(this.group.position);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.mat.dispose();
    if (this.label) {
      this.label.material.map.dispose();
      this.label.material.dispose();
    }
  }
}

export class Ghosts {
  constructor(scene) {
    this.scene = scene;
    this.all = new Map();   // peer id -> Ghost
  }

  // `ids` is everyone present, including us. Seats follow the scoreboard's
  // order, so P2's outline is the same colour as P2's column.
  sync(ids, me) {
    const order = [...new Set(ids.map(Number))].sort((a, b) => a - b);
    const mine = Math.max(0, order.indexOf(me));
    for (const [id, g] of this.all) {
      if (!order.includes(id) || id === me) {
        g.dispose();
        this.all.delete(id);
      }
    }
    order.forEach((id, i) => {
      if (id === me) return;
      let g = this.all.get(id);
      if (!g) {
        g = new Ghost(this.scene);
        this.all.set(id, g);
      }
      g.setSeat((i - mine) * GAP, i);
    });
  }

  pose(id, msg) {
    const g = this.all.get(id);
    if (g) g.pose(msg);
  }

  muzzle(id, hand) {
    const g = this.all.get(id);
    return g ? g.muzzle(hand) : null;
  }

  update(dt) {
    for (const g of this.all.values()) g.update(dt);
  }
}
