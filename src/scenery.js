import * as THREE from '../vendor/three.module.js';
import { PALETTE, CFG } from './config.js';

const C = (hex) => new THREE.Color(hex);

// A new sun rises in a new colour, and the whole world follows it: sky, grid
// and ridgelines are shader uniforms or line materials already, so recolouring
// the scene is nearly free. Progression you feel rather than read off a number.
export const LEVELS = [
  { sunTop: 0xffd319, sunMid: 0xff8a3d, sunBot: 0xff2975, horizon: 0xff2975, mid: 0x3b0a52,
    gridNear: 0x00f0ff, gridFar: 0xb026ff, ridgeNear: 0x00f0ff, ridgeFar: 0xb84dff },   // amber
  { sunTop: 0xffc2ff, sunMid: 0xff3fd8, sunBot: 0x9d00ff, horizon: 0xff00c8, mid: 0x2a0850,
    gridNear: 0xff4fd8, gridFar: 0x6a00ff, ridgeNear: 0xff4fd8, ridgeFar: 0x7a3bff },   // magenta
  { sunTop: 0xd9c2ff, sunMid: 0x9b5cff, sunBot: 0x3d1aff, horizon: 0x7a2cff, mid: 0x120a3b,
    gridNear: 0x39ff14, gridFar: 0x00bfff, ridgeNear: 0x39ff14, ridgeFar: 0x00bfff },   // violet
  { sunTop: 0xffffff, sunMid: 0xfff1a8, sunBot: 0xff6b00, horizon: 0xff6b00, mid: 0x3a0a00,
    gridNear: 0xffd319, gridFar: 0xff2975, ridgeNear: 0xffd319, ridgeFar: 0xff2975 },   // white-hot
];

// ---------------------------------------------------------------- sky dome
function makeSky() {
  const geo = new THREE.SphereGeometry(500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: C(PALETTE.skyTop) },
      uMid: { value: C(PALETTE.skyMid) },
      uHorizon: { value: C(PALETTE.skyHorizon) },
      uGround: { value: C(PALETTE.skyGround) },
    },
    vertexShader: [
      'varying vec3 vWorld;',
      'void main() {',
      '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround;',
      'varying vec3 vWorld;',
      'void main() {',
      // Direction from the eye, so the floor below can share this exact gradient.
      '  float h = clamp(normalize(vWorld - cameraPosition).y * 0.5 + 0.5, 0.0, 1.0);',
      '  vec3 col = mix(uGround, uHorizon, smoothstep(0.445, 0.5, h));',
      '  col = mix(col, uMid, smoothstep(0.5, 0.66, h));',
      '  col = mix(col, uTop, smoothstep(0.62, 0.96, h));',
      // tighten the glow right at the horizon line
      '  col = mix(col, uHorizon, pow(1.0 - abs(h - 0.5) * 2.0, 14.0) * 0.55);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100;
  return mesh;
}

// ------------------------------------------------------------------- sun
// Vertical gradient with horizontal slots cut out of the lower half, the gaps
// widening toward the bottom. That banding IS the whole aesthetic.
function makeSun() {
  const geo = new THREE.CircleGeometry(44, 96);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTop: { value: C(PALETTE.sunTop) },
      uMid: { value: C(PALETTE.sunMid) },
      uBot: { value: C(PALETTE.sunBot) },
      uTime: { value: 0 },
      uHealth: { value: 1 },   // 1 = full strength; the boss burns out toward 0
      uFlash: { value: 0 },    // white-out on a hit
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot;',
      'uniform float uTime; uniform float uHealth; uniform float uFlash;',
      'varying vec2 vUv;',
      'void main() {',
      '  float y = vUv.y;',
      '  vec3 col = mix(uBot, uMid, smoothstep(0.0, 0.55, y));',
      '  col = mix(col, uTop, smoothstep(0.5, 1.0, y));',
      // slots only in the lower 62%, drifting slowly upward
      '  float alpha = 1.0;',
      '  float band = y + uTime * 0.012;',
      '  if (y < 0.68) {',
      '    float f = (0.68 - y) / 0.68;',
      '    float w = fract(band * 11.0);',
      '    float gap = 0.06 + f * 0.62;',
      '    alpha = step(gap, w);',
      '  }',
      // The gaps between bands are filled near-black rather than cut out. Cut out,
      // they showed the stars through the sun once it rose off the horizon, and it
      // read as a cutout. Near-black keeps the stripes just as crisp.
      '  if (alpha < 0.5) col = vec3(0.035, 0.0, 0.07);',
      // Damage burns the sun out rather than eating it. It keeps its shape and
      // its bands; the colour drains toward a dull ember, and near the end it
      // starts to sputter.
      '  float life = smoothstep(0.0, 1.0, uHealth);',
      '  vec3 ember = vec3(0.16, 0.02, 0.05) + uBot * 0.12;',
      '  col = mix(ember, col, 0.15 + 0.85 * life);',
      '  col *= 1.0 + (1.0 - life) * 0.18 * sin(uTime * 23.0 + y * 9.0);',
      '  col = mix(col, vec3(1.0), uFlash);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const sun = new THREE.Mesh(geo, mat);
  sun.position.set(0, 52, -300);
  sun.renderOrder = -90;
  return sun;
}

// ---------------------------------------------------------- solar flares
// A corona behind the sun: flame tongues flowing outward, and a few big slow
// prominences sweeping round the rim. Invisible while the sun sits on the
// horizon; it lights up as the sun comes for you, and grows wilder as the sun
// is hurt, so a dying sun looks angriest.
//
// One quad and a cheap noise, but it covers a lot of screen when the boss is
// close. Fill rate is the thing to watch at the headset checkpoint.
function makeCorona() {
  const R = 44 * 4.0; // quad half-size; the sun's rim lands at r = 0.25, leaving
                      // room for flares up to three sun-radii out
  const geo = new THREE.PlaneGeometry(R * 2, R * 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uHurt: { value: 0 },
      uInner: { value: C(PALETTE.sunMid) },
      uOuter: { value: C(PALETTE.sunBot) },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime; uniform float uIntensity; uniform float uHurt;',
      'uniform vec3 uInner; uniform vec3 uOuter;',
      'varying vec2 vUv;',
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      // Value noise that wraps round the circle, so there is no seam where the
      // angle jumps from -pi to pi.
      'float ring(vec2 p, float period) {',
      '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
      '  float i0 = mod(i.x, period); float i1 = mod(i.x + 1.0, period);',
      '  float a = hash(vec2(i0, i.y)); float b = hash(vec2(i1, i.y));',
      '  float c = hash(vec2(i0, i.y + 1.0)); float d = hash(vec2(i1, i.y + 1.0));',
      '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
      '}',
      'void main() {',
      '  if (uIntensity < 0.01) discard;',
      '  vec2 p = (vUv - 0.5) * 2.0;',
      '  float r = length(p);',
      '  const float r0 = 0.25;',
      '  if (r < r0 - 0.01 || r > 1.0) discard;',
      '  float a = atan(p.y, p.x);',
      '  float u = a / 6.28318 + 0.5;',
      '  float n1 = ring(vec2(u * 9.0, r * 9.0 - uTime * 1.8), 9.0);',
      '  float n2 = ring(vec2(u * 17.0, r * 16.0 - uTime * 2.9), 17.0);',
      '  float tongues = n1 * 0.65 + n2 * 0.35;',
      '  float prom = pow(max(0.0, sin(a * 3.0 + uTime * 0.35)), 12.0);',
      // Reach is measured in sun-radii (r0), so the flares scale with the sun.
      '  float reach = r0 * (0.2 + tongues * (1.1 + uHurt * 0.7) + prom * (1.6 + uHurt * 0.8));',
      '  float d = (r - r0) / reach;',
      '  if (d > 1.0) discard;',
      '  float body = pow(1.0 - clamp(d, 0.0, 1.0), 1.6) * (0.65 + tongues * 0.95);',
      '  float rim = exp(-max(r - r0, 0.0) * 44.0) * 0.7;',
      '  float k = (body + rim) * uIntensity;',
      '  vec3 col = mix(uInner, uOuter, clamp(d, 0.0, 1.0));',
      '  gl_FragColor = vec4(col * k, k);',
      '}',
    ].join('\n'),
  });
  const corona = new THREE.Mesh(geo, mat);
  corona.position.z = -0.5; // just behind the disc
  corona.renderOrder = -91;
  return corona;
}

// ------------------------------------------------------------ sun shards
// What is left after the black hole: the sun, broken into wedges with jagged,
// glowing crack edges. Same bands and colours as the sun it came from, so it
// reads as the same body in pieces rather than a new enemy.
//
// Each shard draws the whole disc and keeps one wedge of it. The geometry is
// shifted so the wedge's centroid sits at the mesh origin, which means a shard
// rocks about its own middle instead of swinging round where the sun's centre
// used to be.
const SUN_R = 44;

// Distance from the centre of a unit disc to the centroid of a wedge spanning
// `span` radians.
export function wedgeCentroid(span) {
  return (4 * Math.sin(span / 2)) / (3 * span);
}

function makeShard(a0, span, seed) {
  const mid = a0 + span / 2;
  const c = wedgeCentroid(span) * SUN_R;
  const cx = Math.cos(mid) * c;
  const cy = Math.sin(mid) * c;
  const geo = new THREE.CircleGeometry(SUN_R, 96);
  geo.translate(-cx, -cy, 0);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTop: { value: C(PALETTE.sunTop) },
      uMid: { value: C(PALETTE.sunMid) },
      uBot: { value: C(PALETTE.sunBot) },
      uTime: { value: 0 },
      uHealth: { value: 1 },
      uFlash: { value: 0 },
      uA0: { value: a0 },
      uSpan: { value: span },
      uSeed: { value: seed },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBot;',
      'uniform float uTime; uniform float uHealth; uniform float uFlash;',
      'uniform float uA0; uniform float uSpan; uniform float uSeed;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec2 p = (vUv - 0.5) * 2.0;',
      '  float r = length(p);',
      '  if (r > 1.0 || r < 0.05) discard;',
      '  float rel = mod(atan(p.y, p.x) - uA0, 6.28318);',
      // Jagged crack edges: the boundary angle wanders with radius.
      '  float j0 = 0.09 * sin(r * 17.0 + uSeed) + 0.045 * sin(r * 43.0 + uSeed * 2.3);',
      '  float j1 = 0.09 * sin(r * 19.0 + uSeed * 1.7) + 0.045 * sin(r * 39.0 + uSeed * 0.7);',
      '  float d0 = rel - (0.05 + j0);',
      '  float d1 = (uSpan - 0.05 + j1) - rel;',
      '  if (d0 < 0.0 || d1 < 0.0) discard;',
      '  float edge = min(d0, d1) * r;',
      // The sun's own gradient and bands, gaps filled near-black like the whole sun.
      '  float y = vUv.y;',
      '  vec3 col = mix(uBot, uMid, smoothstep(0.0, 0.55, y));',
      '  col = mix(col, uTop, smoothstep(0.5, 1.0, y));',
      '  if (y < 0.68) {',
      '    float f = (0.68 - y) / 0.68;',
      '    float w = fract((y + uTime * 0.012) * 11.0);',
      '    if (w < 0.06 + f * 0.62) col = vec3(0.035, 0.0, 0.07);',
      '  }',
      // Burnt out as it is hurt, the same as the whole sun was.
      '  float life = smoothstep(0.0, 1.0, uHealth);',
      '  vec3 ember = vec3(0.16, 0.02, 0.05) + uBot * 0.12;',
      '  col = mix(ember, col, 0.15 + 0.85 * life);',
      // The fracture glows: molten along every crack, flickering, hotter as the
      // shard weakens.
      '  float crack = exp(-edge * 34.0) * (0.8 + 0.2 * sin(uTime * 13.0 + r * 30.0 + uSeed));',
      '  vec3 molten = mix(uMid, vec3(1.0, 0.95, 0.8), 0.45);',
      '  col += molten * crack * (1.2 + (1.0 - life) * 0.8);',
      '  col += uMid * smoothstep(0.93, 1.0, r) * 0.35;',
      '  col = mix(col, vec3(1.0), uFlash);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 10;
  mesh.visible = false;
  mesh.userData = { a0, span, cx, cy };
  return mesh;
}

// ----------------------------------------------------------------- ground
// The grid is only lines, so on its own the floor is see-through: anything
// below y = 0 -- like a new sun climbing up from under the horizon at dawn --
// shows straight through it. This is an opaque floor painted with the lower
// half of the sky, so it looks the same and hides what is underneath.
function makeGround(skyMaterial) {
  const geo = new THREE.CircleGeometry(900, 64);
  geo.rotateX(-Math.PI / 2);
  // The same shader and the very same uniform objects as the sky, so the floor
  // shows exactly what the sky dome used to show through it -- the horizon
  // glow line included -- and follows level changes and the fade to black.
  const mat = new THREE.ShaderMaterial({
    uniforms: skyMaterial.uniforms,
    vertexShader: skyMaterial.vertexShader,
    fragmentShader: skyMaterial.fragmentShader,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = -0.02;
  m.renderOrder = -95;   // after the sky, before the grid draws on top of it
  return m;
}

// ------------------------------------------------------------- neon grid
function makeGrid() {
  const geo = new THREE.PlaneGeometry(700, 700, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uNear: { value: C(PALETTE.gridNear) },
      uFar: { value: C(PALETTE.gridFar) },
      uCell: { value: CFG.gridCell },
      uSpeed: { value: CFG.gridSpeed },
      uFade: { value: CFG.gridFade },
    },
    vertexShader: [
      'varying vec3 vWorld;',
      'void main() {',
      '  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime; uniform float uCell; uniform float uSpeed; uniform float uFade;',
      'uniform vec3 uNear; uniform vec3 uFar;',
      'varying vec3 vWorld;',
      'void main() {',
      '  vec2 p = vWorld.xz;',
      '  p.y += uTime * uSpeed;',
      '  vec2 g = p / uCell;',
      // analytic anti-aliased grid lines
      '  vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);',
      '  float line = 1.0 - min(min(d.x, d.y), 1.0);',
      '  line = pow(line, 1.4);',
      // once a cell is smaller than a pixel there is no line left to draw
      '  float lod = max(fwidth(g.x), fwidth(g.y));',
      '  float aa = 1.0 - smoothstep(0.30, 0.95, lod);',
      '  float dist = length(vWorld.xz);',
      '  float fade = 1.0 - smoothstep(uFade * 0.25, uFade, dist);',
      '  vec3 col = mix(uNear, uFar, smoothstep(6.0, uFade * 0.8, dist));',
      '  float a = line * fade * aa;',
      '  if (a < 0.01) discard;',
      '  gl_FragColor = vec4(col * (1.0 + line * 0.9), a);',
      '}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 0.01;
  mesh.renderOrder = -80;
  return mesh;
}

// -------------------------------------------------------------- mountains
// A ring of jagged peaks: a dark solid body so it actually occludes, plus a
// bright line along the ridge for the neon silhouette.
function makeRidge(radius, baseHeight, jag, edgeColor, segments) {
  const group = new THREE.Group();
  const heights = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const v =
      Math.sin(a * 3.1) * 0.5 +
      Math.sin(a * 7.3 + 1.7) * 0.3 +
      Math.sin(a * 13.7 + 4.2) * 0.22 +
      Math.sin(a * 29.1 + 2.5) * 0.16;
    heights.push(Math.max(2, baseHeight + v * jag));
  }

  // Solid body.
  const pos = [];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = (j / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * radius;
    const z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius;
    const z1 = Math.sin(a1) * radius;
    pos.push(x0, 0, z0, x0, heights[i], z0, x1, 0, z1);
    pos.push(x1, 0, z1, x0, heights[i], z0, x1, heights[j], z1);
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  group.add(new THREE.Mesh(
    bodyGeo,
    new THREE.MeshBasicMaterial({ color: C(PALETTE.mountainFill), side: THREE.DoubleSide })
  ));

  // Neon ridge line.
  const linePts = [];
  for (let i = 0; i <= segments; i++) {
    const k = i % segments;
    const a = (k / segments) * Math.PI * 2;
    linePts.push(Math.cos(a) * radius, heights[k], Math.sin(a) * radius);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
  group.add(new THREE.Line(
    lineGeo,
    new THREE.LineBasicMaterial({ color: C(edgeColor), transparent: true, opacity: 0.95 })
  ));

  // Vertical struts -- reads as classic wireframe terrain.
  const strut = [];
  for (let i = 0; i < segments; i += 3) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    strut.push(x, 0, z, x, heights[i], z);
  }
  const strutGeo = new THREE.BufferGeometry();
  strutGeo.setAttribute('position', new THREE.Float32BufferAttribute(strut, 3));
  group.add(new THREE.LineSegments(
    strutGeo,
    new THREE.LineBasicMaterial({ color: C(edgeColor), transparent: true, opacity: 0.32 })
  ));

  return group;
}

// ------------------------------------------------------------------ stars
function makeStars() {
  const n = 500;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const y = 0.15 + Math.random() * 0.85;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * 420;
    pos[i * 3 + 1] = y * 420;
    pos[i * 3 + 2] = Math.sin(a) * r * 420;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      // Stars are meant to read as infinitely far away, and fog here is a bug
      // with a shape: three.js fogs by view-space depth, not radial distance,
      // so a star straight ahead is ~420 deep and heavily fogged while one off
      // to the side is 420*cos(angle) deep and barely touched. The result is a
      // wash centred on wherever you are looking that follows the crosshair
      // around and eats the stars near it.
      fog: false,
    })
  );
}

export function buildScenery(scene) {
  const sky = makeSky();
  const sun = makeSun();
  const corona = makeCorona();
  sun.add(corona);
  const grid = makeGrid();
  const ground = makeGround(sky.material);
  const stars = makeStars();
  const far = makeRidge(250, 26, 12, PALETTE.ridgeFar, 170);
  const near = makeRidge(150, 11, 7, PALETTE.ridgeNear, 130);

  scene.add(sky, ground, stars, sun, far, near, grid);

  const HOME = { y: sun.position.y, z: sun.position.z };
  const ridgeLine = (ridge, color) => {
    ridge.children[1].material.color.copy(color);
    ridge.children[2].material.color.copy(color);
  };

  // The world's colour is the current level's palette, dimmed by `darkness`.
  // Darkness is how the world goes black after the last shard dies and light
  // breaks again at dawn -- in the new level's colours.
  let level = 0;
  let darkness = 0;
  // One scratch colour: every use below copies it straight out.
  const dimmed = new THREE.Color();
  const dim = (hex, k) => dimmed.set(hex).multiplyScalar(k);
  const paint = () => {
    const L = LEVELS[Math.min(level, LEVELS.length - 1)];
    const su = sun.material.uniforms;
    su.uTop.value.set(L.sunTop);
    su.uMid.value.set(L.sunMid);
    su.uBot.value.set(L.sunBot);
    corona.material.uniforms.uInner.value.set(L.sunMid);
    corona.material.uniforms.uOuter.value.set(L.sunBot);
    const k = 1 - darkness;
    sky.material.uniforms.uHorizon.value.copy(dim(L.horizon, k));
    sky.material.uniforms.uMid.value.copy(dim(L.mid, k));
    // The floor never goes fully dark: in a headset, losing the ground entirely
    // is disorienting, and the stars alone do not give you one.
    const g = Math.max(0.12, k);
    grid.material.uniforms.uNear.value.copy(dim(L.gridNear, g));
    grid.material.uniforms.uFar.value.copy(dim(L.gridFar, g));
    ridgeLine(near, dim(L.ridgeNear, g));
    ridgeLine(far, dim(L.ridgeFar, g));
  };

  return {
    update(t) {
      grid.material.uniforms.uTime.value = t;
      sun.material.uniforms.uTime.value = t;
      // Wrapped, because the noise hashes time and large inputs lose precision
      // on a mobile GPU well before anyone has played for ten minutes.
      corona.material.uniforms.uTime.value = t % 600;
      stars.rotation.y = t * 0.005;
    },

    sunHome: HOME,
    sunRadius: 44,   // the CircleGeometry radius, before scaling

    // `near` is 0 at home on the horizon and 1 hanging over the grid as a boss.
    // Close up it has to draw over the mountains -- it is now in front of them.
    setSun(y, z, scale, near) {
      sun.position.set(0, y, z);
      sun.scale.setScalar(scale);
      sun.renderOrder = near > 0.01 ? 10 : -90;
      corona.renderOrder = sun.renderOrder - 1;
    },
    // intensity 0 means no flares; hurt 0..1 is how much damage it has taken.
    setSunFlare(intensity, hurt) {
      corona.material.uniforms.uIntensity.value = intensity;
      corona.material.uniforms.uHurt.value = hurt;
    },
    setSunHealth(f) {
      sun.material.uniforms.uHealth.value = Math.max(0, Math.min(1, f));
    },
    setSunFlash(f) {
      sun.material.uniforms.uFlash.value = f;
    },
    sunPosition() {
      return sun.position;
    },
    sunScale() {
      return sun.scale.x;
    },

    applyLevel(i) {
      level = i;
      paint();
    },

    // 0 = the world in full colour, 1 = black but for the stars.
    setWorldDark(d) {
      d = Math.max(0, Math.min(1, d));
      if (Math.abs(d - darkness) < 1e-4) return;
      darkness = d;
      paint();
    },

    // A wedge of the sun spanning [a0, a0 + span], in the colours of `lvl`.
    createShard(a0, span, seed, lvl) {
      const m = makeShard(a0, span, seed);
      const L = LEVELS[Math.min(lvl, LEVELS.length - 1)];
      const u = m.material.uniforms;
      u.uTop.value.set(L.sunTop);
      u.uMid.value.set(L.sunMid);
      u.uBot.value.set(L.sunBot);
      scene.add(m);
      return m;
    },
    disposeShard(m) {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    },
  };
}
