import * as THREE from '../vendor/three.module.js';
import { PALETTE } from './config.js';

const HEX = (n) => '#' + n.toString(16).padStart(6, '0');

// Flat-screen cue for targets outside the view.
//
// In VR you have peripheral vision and a neck. On a monitor you have 70 degrees
// and a mouse, so with targets falling from every bearing the first sign of one
// behind you would be a lost shield. Each unseen target gets a chevron pinned
// to the edge of the screen, pointing at it, in its own colour -- cyan means
// turn and shoot it, pink means leave it alone.
export class OffscreenCues {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.inv = new THREE.Matrix4();
    this.p = new THREE.Vector3();
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
  }

  // `ang` is the bearing on screen in NDC terms: 0 = right, PI/2 = up.
  _chevron(ang, color) {
    const c = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const rx = cx - 46;
    const ry = cy - 46;
    const x = cx + Math.cos(ang) * rx;
    const y = cy - Math.sin(ang) * ry; // canvas Y grows downward

    c.save();
    c.translate(x, y);
    c.rotate(-ang);
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 12;
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(13, 0);
    c.lineTo(-7, -9);
    c.lineTo(-2, 0);
    c.lineTo(-7, 9);
    c.closePath();
    c.fill();
    c.restore();
  }

  draw(targets, camera) {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    if (!targets.length) return;

    camera.updateMatrixWorld();
    this.inv.copy(camera.matrixWorld).invert();
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanH = tanV * camera.aspect;

    for (const t of targets) {
      this.p.copy(t.obj.position).applyMatrix4(this.inv);
      const forward = -this.p.z; // camera looks down -Z
      let ang;
      if (forward > 0.05) {
        const nx = this.p.x / (forward * tanH);
        const ny = this.p.y / (forward * tanV);
        if (Math.abs(nx) <= 1 && Math.abs(ny) <= 1) continue; // already visible
        ang = Math.atan2(ny, nx);
      } else {
        // Behind the eye: the projection above would flip it to the wrong side,
        // so take the bearing straight from the camera-space direction.
        ang = Math.atan2(this.p.y, this.p.x);
      }
      this._chevron(ang, HEX(t.color || PALETTE.target));
    }
  }
}
