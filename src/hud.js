import * as THREE from '../vendor/three.module.js';
import { PALETTE, CFG, MODES, MODE_ORDER } from './config.js';
import { KINDS } from './targets.js';

// A held weapon is labelled in the colour of the pickup that granted it, so the
// HUD and the thing you shot agree.
function weaponStyle(name) {
  const k = KINDS.find((x) => x.weapon === name);
  return { label: name.toUpperCase(), color: k ? k.wire : PALETTE.sunTop };
}

const HEX = (n) => '#' + n.toString(16).padStart(6, '0');

// Column colours for other players, by seat. Yours is always sunTop.
export const SEAT = [PALETTE.gridNear, PALETTE.gridFar, 0x39ff14, 0xff6b00];

// Text drawn to a 2D canvas and used as a texture. Avoids shipping a font
// atlas and lets us fake neon glow with shadowBlur for free.
class Panel {
  constructor(w, h, worldW) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const worldH = (worldW * h) / w;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
      })
    );
  }

  glowText(text, x, y, size, color, align = 'center') {
    const c = this.ctx;
    c.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.shadowColor = color;
    c.shadowBlur = size * 0.55;
    c.fillStyle = color;
    c.fillText(text, x, y);
    c.fillText(text, x, y); // second pass = hotter core
    c.shadowBlur = 0;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  commit() {
    this.texture.needsUpdate = true;
  }
}

export class HUD {
  constructor(scene) {
    // World-anchored, not head-locked: head-locked UI is a nausea machine.
    // The whole HUD hangs off one group so the flat-screen build can rotate it
    // as a unit (see faceYaw) without touching the VR behaviour.
    this.group = new THREE.Group();
    scene.add(this.group);
    this.yaw = 0;

    this.score = new Panel(1024, 200, 3.0);
    this.score.mesh.position.set(0, 0.95, -3.6);
    this.score.mesh.rotation.x = 0.32;
    this.group.add(this.score.mesh);

    this.center = new Panel(1024, 512, 5.2);
    this.center.mesh.position.set(0, 2.15, -5.2);
    this.group.add(this.center.mesh);

    // The mode buttons on the title and game-over screens. You pick one by
    // shooting it, which works the same with a mouse, a pad or a controller.
    this.modes = MODE_ORDER.map((name, i) => {
      const panel = new Panel(512, 168, 1.3);
      panel.mesh.position.set((i - 1) * 1.45, 1.33, -4.0);
      panel.mesh.userData.mode = name;
      panel.mesh.visible = false;
      this.group.add(panel.mesh);
      return { name, panel, hot: null };
    });
    this.modesShown = false;
    this._ray = new THREE.Raycaster();
  }

  showModes(on) {
    if (on === this.modesShown) return;
    this.modesShown = on;
    for (const m of this.modes) {
      m.panel.mesh.visible = on;
      if (on) this._drawMode(m, false);
    }
  }

  _drawMode(m, hot) {
    if (m.hot === hot) return;
    m.hot = hot;
    const spec = MODES[m.name];
    const p = m.panel;
    const c = p.ctx;
    const col = HEX(spec.color);
    p.clear();
    c.fillStyle = hot ? 'rgba(40, 10, 60, 0.85)' : 'rgba(10, 0, 20, 0.6)';
    c.fillRect(8, 8, 496, 152);
    c.strokeStyle = col;
    c.shadowColor = col;
    c.shadowBlur = hot ? 26 : 10;
    c.lineWidth = hot ? 7 : 3;
    c.strokeRect(8, 8, 496, 152);
    c.shadowBlur = 0;
    p.glowText(spec.label, 256, 62, hot ? 64 : 56, col);
    p.glowText(spec.blurb, 256, 122, 34, hot ? '#ffffff' : HEX(PALETTE.gridNear));
    p.commit();
  }

  // Which mode, if any, a ray points at.
  pickMode(origin, dir) {
    if (!this.modesShown || !origin || !dir) return null;
    this.group.updateMatrixWorld(true);
    this._ray.set(origin, dir);
    const hit = this._ray.intersectObjects(this.modes.map((m) => m.panel.mesh), false)[0];
    return hit ? hit.object.userData.mode : null;
  }

  // Light up whichever buttons are being aimed at.
  hoverModes(rays) {
    if (!this.modesShown) return;
    const hot = new Set(rays.map((r) => this.pickMode(r.origin, r.dir)).filter(Boolean));
    for (const m of this.modes) this._drawMode(m, hot.has(m.name));
  }

  // Flat screen only. Targets fall from every bearing now, so the player turns
  // a long way from their start facing; the panels follow, lagging behind so
  // the swing reads as a turn rather than a snap. Never called with anything
  // but 0 while presenting -- in VR you turn your head, and a HUD that chases
  // your head is the nausea machine mentioned above.
  //
  // `slack` is how far the view may wander before the panels follow at all.
  // The mode buttons need it: without it, aiming at a side button swings the
  // panels toward your aim, and the button slides out from under the crosshair.
  faceYaw(yaw, dt, slack = 0) {
    let delta = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    delta = Math.sign(delta) * Math.max(0, Math.abs(delta) - slack);
    // Exponential, not delta * dt * k: the catch-up has to take the same wall
    // time whether the frame rate is 90 or 20.
    this.yaw += delta * (1 - Math.exp(-6 * dt));
    this.group.rotation.y = this.yaw;
  }

  drawScore({ lives, books, me, mode }) {
    const p = this.score;
    const c = p.ctx;
    p.clear();

    // Id-ascending, so a player keeps the same column for the whole session and
    // the labels are seat numbers rather than raw peer ids -- a reconnect must
    // not produce a column called P7.
    const ids = Object.keys(books || {}).map(Number).sort((a, b) => a - b);
    const seats = ids.slice(0, 4);

    const mineRow = (books && books[me]) || { score: 0, combo: 1 };
    const held = mineRow.weapon ? weaponStyle(mineRow.weapon) : null;
    const heldText = held ? `${held.label} ${Math.ceil(mineRow.weaponT || 0)}` : '';

    if (seats.length <= 1) {
      p.glowText(String(mineRow.score).padStart(6, '0'), 512, 70, 84, HEX(PALETTE.sunTop));
      if (mineRow.combo > 1.01) {
        p.glowText(`x${mineRow.combo.toFixed(2)}`, 800, 150, 40, HEX(PALETTE.skyHorizon));
      }
      if (held) p.glowText(heldText, 170, 70, 36, HEX(held.color));
    } else {
      const n = seats.length;
      const size = n <= 2 ? 66 : 48;
      seats.forEach((id, i) => {
        const row = books[id];
        const mine = id === me;
        // Yours is always the bright yellow one. You have to find your own
        // number at a glance while something is falling at you.
        const col = HEX(mine ? PALETTE.sunTop : SEAT[i % SEAT.length]);
        const x = ((i + 0.5) * 1024) / n;
        p.glowText(String(row.score).padStart(6, '0'), x, 54, size, col);
        p.glowText(mine ? 'YOU' : `P${i + 1}`, x, 98, 22, col);
        if (row.combo > 1.01) {
          p.glowText(`x${row.combo.toFixed(2)}`, x, 126, 24, col);
        }
        // Everyone's weapon is visible, not just yours -- "who has the shotgun"
        // is part of the fun of sharing a screen.
        if (row.weapon) {
          const w = weaponStyle(row.weapon);
          p.glowText(`${w.label} ${Math.ceil(row.weaponT || 0)}`, x, 148, 18, HEX(w.color));
        }
      });
    }

    // Shields are shared, so the row is centred whatever the column count.
    const rowY = seats.length > 1 ? 176 : 150;
    p.glowText('SHIELDS', 392, rowY, 30, HEX(PALETTE.gridNear));
    const spec = MODES[mode];
    if (spec) p.glowText(spec.label, 150, rowY, 24, HEX(spec.color));
    if (CFG.infiniteLives) {
      // Say it loudly. A cheat you forgot you left on turns into a bug report.
      p.glowText('∞  TEST MODE', 492, rowY, 30, HEX(PALETTE.bomb), 'left');
    } else if (spec && spec.infinite) {
      p.glowText('∞', 492, rowY, 40, HEX(PALETTE.gridNear), 'left');
    } else {
      for (let i = 0; i < CFG.lives; i++) {
        c.fillStyle = i < lives ? HEX(PALETTE.gridNear) : '#2a1a44';
        c.fillRect(502 + i * 30, rowY - 12, 20, 24);
      }
    }
    p.commit();
  }

  drawCenter(lines) {
    const p = this.center;
    p.clear();
    if (!lines) {
      p.mesh.visible = false;
      p.commit();
      return;
    }
    p.mesh.visible = true;
    let y = 256 - ((lines.length - 1) * 78) / 2;
    for (const l of lines) {
      p.glowText(l.text, 512, y, l.size || 56, l.color || HEX(PALETTE.gridNear));
      y += 78;
    }
    p.commit();
  }
}
