import * as THREE from '../vendor/three.module.js';

// How the sun dies: collapse, supernova, black hole, nothing.
//
// That is the real order of things for a large star, and it gives the kill
// three beats instead of one -- a gasp, a blast, and something eerie left
// hanging in the sky long enough to look at.
//
// Everything here is a handful of quads and one sphere with cheap shaders. No
// extra render passes: real gravitational lensing would need the scene rendered
// twice, which a Quest cannot afford in stereo, so the lensing is faked with the
// shape of the accretion disc instead.

// Seconds into the death.
export const NOVA = {
  collapse: 0.55,   // the sun shrinks and goes white-hot
  shock: 1.6,       // how long the shockwave takes to sweep out past the players
  holeIn: 0.8,      // black hole starts to form
  holeFull: 1.4,
  holeOut: 3.2,     // it starts collapsing to nothing
  end: 3.8,
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const VERT_UV = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}',
].join('\n');

// --- the flash: a huge soft glow that spikes and fades -----------------------
function makeFlash() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uAmount: { value: 0 }, uColor: { value: new THREE.Color() } },
    vertexShader: VERT_UV,
    fragmentShader: [
      'uniform float uAmount; uniform vec3 uColor;',
      'varying vec2 vUv;',
      'void main() {',
      '  float r = length((vUv - 0.5) * 2.0);',
      '  if (r > 1.0 || uAmount < 0.002) discard;',
      '  float core = exp(-r * r * 9.0);',
      '  float wide = exp(-r * 2.6) * 0.6;',
      '  vec3 col = mix(uColor, vec3(1.0), core);',
      '  float k = (core + wide) * uAmount;',
      '  gl_FragColor = vec4(col * k, k);',
      '}',
    ].join('\n'),
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = 30;
  m.frustumCulled = false;
  return m;
}

// --- the shockwave: a shell that grows out of the sun and passes through you ---
// Bright where you see it edge-on, clear face-on, so it reads as a thin wall of
// light. Once it is bigger than the distance to the players they are inside it,
// and it becomes a glowing rim sweeping out past the edges of their view.
function makeShock() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uFade: { value: 0 }, uColor: { value: new THREE.Color() } },
    vertexShader: [
      'varying vec3 vN; varying vec3 vV;',
      'void main() {',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
      '  vN = normalize(normalMatrix * normal);',
      '  vV = normalize(-mv.xyz);',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uFade; uniform vec3 uColor;',
      'varying vec3 vN; varying vec3 vV;',
      'void main() {',
      '  if (uFade < 0.002) discard;',
      '  float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));',
      '  float k = pow(edge, 3.0) * uFade;',
      '  vec3 col = mix(uColor, vec3(1.0), pow(edge, 8.0));',
      '  gl_FragColor = vec4(col * k * 1.6, k);',
      '}',
    ].join('\n'),
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  m.renderOrder = 29;
  m.frustumCulled = false;
  return m;
}

// --- the black hole ------------------------------------------------------------
// A void that blocks out the stars behind it, a thin photon ring hugging the
// horizon, and an accretion disc seen almost edge-on: brighter on the side
// spinning toward you, passing in front of the hole along the bottom, with the
// far side of the disc bent up over the top the way light is lensed round one.
function makeHole() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 0 },
      uHot: { value: new THREE.Color() },
      uCool: { value: new THREE.Color() },
    },
    vertexShader: VERT_UV,
    fragmentShader: [
      'uniform float uTime; uniform float uFade;',
      'uniform vec3 uHot; uniform vec3 uCool;',
      'varying vec2 vUv;',
      'void main() {',
      '  if (uFade < 0.002) discard;',
      '  vec2 p = (vUv - 0.5) * 2.0;',
      '  float r = length(p);',
      '  if (r > 1.0) discard;',
      '  const float rh = 0.2;',                                // event horizon
      '  float hole = 1.0 - smoothstep(rh - 0.008, rh + 0.008, r);',
      // Light near it is being swallowed: the sky darkens toward the hole.
      '  float halo = (1.0 - smoothstep(rh, rh * 3.6, r)) * 0.8;',
      // The disc, squashed flat because we see it nearly edge-on.
      '  vec2 q = vec2(p.x, p.y / 0.22);',
      '  float rd = length(q);',
      '  float ang = atan(q.y, q.x);',
      '  float band = smoothstep(0.27, 0.34, rd) * (1.0 - smoothstep(0.5, 0.92, rd));',
      '  float swirl = 0.5 + 0.5 * sin(ang * 5.0 - uTime * 7.0 + rd * 22.0);',
      '  float streak = 0.5 + 0.5 * sin(ang * 13.0 - uTime * 11.0 - rd * 40.0);',
      // Doppler beaming: the side coming toward you is far brighter.
      '  float beam = 0.35 + 0.65 * pow(0.5 + 0.5 * cos(ang), 1.5);',
      '  vec3 disc = mix(uCool, uHot, swirl) * (0.7 + 0.6 * streak) * beam;',
      // The near half of the disc passes in front of the hole; the far half is
      // hidden behind it.
      '  float front = step(p.y, 0.0);',
      '  float discA = band * (front + (1.0 - front) * (1.0 - hole));',
      // The far side of the disc, lensed up and over the top of the hole.
      '  float arcR = rh * 1.55;',
      '  float arc = exp(-pow((r - arcR) / 0.035, 2.0)) * smoothstep(-0.05, 0.12, p.y);',
      '  float arcBright = 0.6 + 0.4 * sin(atan(p.y, p.x) * 6.0 - uTime * 5.0);',
      '  float ring = exp(-pow((r - rh * 1.06) / 0.0055, 2.0)) * (0.55 + 0.45 * beam);',
      '  vec3 col = disc * discA * 1.7 + uHot * arc * arcBright * 1.4 + mix(uHot, vec3(1.0), 0.55) * ring * 1.15;',
      '  float a = max(max(hole, halo), clamp(discA + arc * 0.9 + ring * 0.8, 0.0, 1.0));',
      // Where the hole itself is, and no disc crosses it, it is simply black.
      '  col *= 1.0 - hole * (1.0 - front * band);',
      '  gl_FragColor = vec4(col, a * uFade);',
      '}',
    ].join('\n'),
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.renderOrder = 28;
  m.frustumCulled = false;
  return m;
}

// `opts.hole` false gives the small version a shard dies with: flash and
// shockwave, no black hole, and a shockwave that stays well short of the
// players rather than washing over them.
export function makeSupernova(scene, camera, opts = {}) {
  const withHole = opts.hole !== false;
  const shockReach = opts.shockReach || 150;
  const flash = makeFlash();
  const shock = makeShock();
  const hole = makeHole();
  scene.add(hole, shock, flash);

  const eye = new THREE.Vector3();
  const hide = () => {
    flash.visible = false;
    shock.visible = false;
    hole.visible = false;
  };
  hide();

  return {
    // t: seconds into the death. center/radius: the sun's position and size
    // when it started to die. colors: that sun's palette entry. clock: for the
    // disc's spin.
    update(t, center, radius, colors, clock) {
      if (t < 0 || t > NOVA.end) {
        hide();
        return;
      }
      camera.getWorldPosition(eye);

      // Flash: builds through the collapse, spikes at the moment of the nova.
      const flashAmt =
        t < NOVA.collapse
          ? smooth(0, NOVA.collapse, t) * 0.5
          : Math.pow(Math.max(0, 1 - (t - NOVA.collapse) / 0.75), 2) * 2.4;
      flash.visible = flashAmt > 0.002;
      flash.position.copy(center);
      flash.lookAt(eye);
      flash.scale.setScalar(radius * (t < NOVA.collapse ? 3 : 3 + (t - NOVA.collapse) * 11));
      flash.material.uniforms.uAmount.value = flashAmt;
      flash.material.uniforms.uColor.value.set(colors.sunTop);

      // Shockwave: from the sun out past the players. Distance to the players
      // is about 50 metres, so it sweeps through them a little over a third of
      // the way through its run.
      const s = (t - NOVA.collapse) / NOVA.shock;
      shock.visible = s > 0 && s < 1;
      if (shock.visible) {
        shock.position.copy(center);
        shock.scale.setScalar(2 + s * shockReach);
        shock.material.uniforms.uFade.value = (1 - s) * (1 - s) * 1.3;
        shock.material.uniforms.uColor.value.set(colors.sunMid);
      }

      // Black hole: forms in the aftermath, hangs there, collapses to nothing.
      const grow = smooth(NOVA.holeIn, NOVA.holeFull, t);
      const shrink = 1 - smooth(NOVA.holeOut, NOVA.end, t);
      const k = withHole ? grow * shrink : 0;
      hole.visible = k > 0.002;
      if (hole.visible) {
        hole.position.copy(center);
        hole.lookAt(eye);
        // It overshoots slightly as it forms, then settles -- and on the way out
        // it pinches down faster than it fades.
        const size = radius * 3.5 * (0.6 + 0.4 * grow + 0.12 * Math.sin(grow * Math.PI)) * Math.pow(shrink, 0.6);
        hole.scale.setScalar(Math.max(0.01, size));
        const u = hole.material.uniforms;
        u.uFade.value = Math.min(1, grow * 1.4) * Math.min(1, shrink * 2);
        u.uTime.value = clock % 600;
        u.uHot.value.set(colors.sunTop);
        u.uCool.value.set(colors.sunBot);
      }
    },
    hide,
  };
}
