import * as THREE from '../vendor/three.module.js';

// The later stages of a star's life: pulsars, and the nebula the dead ones
// leave behind for a new star to form out of.
//
// Everything here is a few additive quads and cones with cheap shaders. The
// nebula is the heavy one -- a big quad of layered noise -- so it is the thing
// to watch for fill rate on a Quest, alongside the sun's flares.

const VERT_UV = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}',
].join('\n');

const NOISE = [
  'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
  'float vnoise(vec2 p) {',
  '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),',
  '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
  '}',
  'float fbm(vec2 p) {',
  '  float v = 0.0; float a = 0.55;',
  '  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }',
  '  return v;',
  '}',
].join('\n');

// ------------------------------------------------------------------ pulsar
// A collapsed shard of the sun: a tiny, blinding, spinning core with two
// lighthouse beams sweeping round it. The beams are long enough to sweep past
// the players, so in a headset they wash over you.
function makeCore() {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uColor: { value: new THREE.Color() },
        uAlpha: { value: 0 }, uFlash: { value: 0 }, uHealth: { value: 1 },
      },
      vertexShader: VERT_UV,
      fragmentShader: [
        'uniform float uTime; uniform vec3 uColor; uniform float uAlpha; uniform float uFlash; uniform float uHealth;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 p = (vUv - 0.5) * 2.0;',
        '  float r = length(p);',
        '  if (r > 1.0 || uAlpha < 0.002) discard;',
        // It pulses: that is what makes it a pulsar. Faster as it weakens.
        '  float beat = 0.75 + 0.25 * sin(uTime * (9.0 + (1.0 - uHealth) * 14.0));',
        '  float core = exp(-r * r * 60.0);',
        '  float glow = exp(-r * 4.5) * 0.8;',
        // A four-point glint, slowly turning.
        '  float a = atan(p.y, p.x) + uTime * 0.6;',
        '  float glint = pow(abs(cos(a * 2.0)), 40.0) * (1.0 - r) * 0.9;',
        '  vec3 col = mix(uColor, vec3(1.0), core + glint * 0.5 + uFlash);',
        '  float k = (core * 2.6 + glow * 1.4 + glint * 1.3) * beat * uAlpha;',
        '  gl_FragColor = vec4(col * k, k);',
        '}',
      ].join('\n'),
    })
  );
}

function makeBeam() {
  // Narrow at the core, wide at the far end, along +Z from the origin.
  const geo = new THREE.CylinderGeometry(0.04, 1, 1, 16, 1, true);
  geo.translate(0, 0.5, 0);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: [
        'varying float vAlong; varying float vFacing;',
        'void main() {',
        '  vAlong = position.z;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor; uniform float uAlpha; uniform float uTime;',
        'varying float vAlong; varying float vFacing;',
        'void main() {',
        '  float fade = pow(1.0 - clamp(vAlong, 0.0, 1.0), 1.3);',
        '  float ripple = 0.8 + 0.2 * sin(vAlong * 40.0 - uTime * 18.0);',
        '  float k = pow(vFacing, 1.2) * fade * ripple * uAlpha * 1.25;',
        '  gl_FragColor = vec4(mix(uColor, vec3(1.0), fade * 0.4) * k, k);',
        '}',
      ].join('\n'),
    })
  );
}

export function makePulsar(scene, seed) {
  const group = new THREE.Group();
  const core = makeCore();
  const beamA = makeBeam();
  const beamB = makeBeam();
  core.frustumCulled = beamA.frustumCulled = beamB.frustumCulled = false;
  group.add(beamA, beamB, core);
  group.visible = false;
  scene.add(group);

  // Spin axis roughly up, magnetic axis tilted off it: the beams trace a cone,
  // which is exactly the lighthouse sweep.
  const spin = new THREE.Vector3(Math.sin(seed) * 0.25, 1, Math.cos(seed * 1.7) * 0.25).normalize();
  const u = new THREE.Vector3(1, 0, 0).cross(spin).normalize();
  const v = new THREE.Vector3().crossVectors(spin, u);
  const tilt = 0.95;              // radians between spin axis and beam
  const rate = 1.1 + seed * 0.13; // each one sweeps at its own pace
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const eye = new THREE.Vector3();

  return {
    group,
    // alpha: 0..1 presence. health: 0..1. beams: 0..1.
    update(position, clock, camera, colors, alpha, health, flash, beams, size) {
      group.visible = alpha > 0.002;
      if (!group.visible) return;
      group.position.copy(position);
      camera.getWorldPosition(eye);
      core.lookAt(eye);
      core.scale.setScalar(size);
      const cu = core.material.uniforms;
      cu.uTime.value = clock % 600;
      cu.uColor.value.set(colors.gridNear);
      cu.uAlpha.value = alpha;
      cu.uFlash.value = flash;
      cu.uHealth.value = health;

      const ang = clock * rate + seed * 4;
      dir.copy(spin).multiplyScalar(Math.cos(tilt))
        .add(tmp.copy(u).multiplyScalar(Math.sin(tilt) * Math.cos(ang)))
        .add(tmp.copy(v).multiplyScalar(Math.sin(tilt) * Math.sin(ang)));
      const len = 70;
      const width = 3.2 + (1 - health) * 2.4;
      for (const [beam, sign] of [[beamA, 1], [beamB, -1]]) {
        beam.visible = beams > 0.002;
        beam.lookAt(tmp.copy(position).addScaledVector(dir, sign));
        beam.scale.set(width, width, len);
        const bu = beam.material.uniforms;
        bu.uColor.value.set(colors.gridNear);
        bu.uAlpha.value = beams * alpha;
        bu.uTime.value = clock % 600;
      }
    },
    dispose() {
      scene.remove(group);
      for (const m of [core, beamA, beamB]) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}

// ------------------------------------------------------------------ nebula
// What the dead pulsars leave behind: a glowing cloud of gas in two of the
// level's colours, threaded with dark lanes and slowly turning. When it is the
// boss, damage makes it contract -- denser, smaller, its core brighter -- until
// it collapses into a new star.
export function makeNebula(scene, seed) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uSeed: { value: seed },
        uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uCore: { value: new THREE.Color() },
        uAlpha: { value: 0 }, uContract: { value: 0 }, uSwirl: { value: 0.3 }, uFlash: { value: 0 },
      },
      vertexShader: VERT_UV,
      fragmentShader: [
        'uniform float uTime; uniform float uSeed;',
        'uniform vec3 uA; uniform vec3 uB; uniform vec3 uCore;',
        'uniform float uAlpha; uniform float uContract; uniform float uSwirl; uniform float uFlash;',
        'varying vec2 vUv;',
        NOISE,
        'void main() {',
        '  if (uAlpha < 0.002) discard;',
        '  vec2 p = (vUv - 0.5) * 2.0;',
        // Contracting pulls everything toward the middle.
        '  vec2 q = p * (1.0 + uContract * 0.8);',
        '  float r = length(q);',
        '  if (r > 1.0 && uContract < 0.01) discard;',
        // A swirl that is fastest near the centre, like something starting to fall in.
        '  float ang = uTime * 0.06 * uSwirl * (1.6 - min(r, 1.4)) + uContract * 1.5 * (1.0 - min(r, 1.0));',
        '  float c = cos(ang), s = sin(ang);',
        '  vec2 w = vec2(q.x * c - q.y * s, q.x * s + q.y * c);',
        '  vec2 drift = vec2(uTime * 0.012, -uTime * 0.008);',
        '  float n1 = fbm(w * 1.8 + uSeed + drift);',
        '  float n2 = fbm(w * 3.1 + n1 * 1.6 - uSeed * 0.7 - drift);',
        '  float falloff = pow(clamp(1.0 - r, 0.0, 1.0), 1.3);',
        '  float density = smoothstep(0.2, 0.72, n1 * 0.7 + n2 * 0.5) * falloff;',
        // Dark dust lanes cutting through the glow.
        '  float lanes = smoothstep(0.42, 0.5, n2) * 0.65 + 0.35;',
        '  vec3 col = mix(uA, uB, smoothstep(0.35, 0.75, n2)) * lanes;',
        // The heart of it, brightening as it contracts toward a new star.
        '  float core = exp(-r * r * (9.0 + uContract * 22.0)) * (0.3 + uContract * 2.0);',
        '  col = col * density * 2.4 + uCore * core;',
        '  col = mix(col, vec3(1.0), uFlash * (density + core));',
        '  float k = clamp(density * 1.2 + core, 0.0, 1.0) * uAlpha;',
        '  gl_FragColor = vec4(col * uAlpha, k);',
        '}',
      ].join('\n'),
    })
  );
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 8;
  scene.add(mesh);
  const eye = new THREE.Vector3();

  return {
    mesh,
    update(position, size, clock, camera, colors, alpha, contract, swirl, flash) {
      mesh.visible = alpha > 0.002;
      if (!mesh.visible) return;
      mesh.position.copy(position);
      camera.getWorldPosition(eye);
      mesh.lookAt(eye);
      mesh.scale.setScalar(size);
      const u = mesh.material.uniforms;
      u.uTime.value = clock % 600;
      u.uA.value.set(colors.sunBot);
      u.uB.value.set(colors.gridNear);
      u.uCore.value.set(colors.sunTop);
      u.uAlpha.value = alpha;
      u.uContract.value = contract;
      u.uSwirl.value = swirl;
      u.uFlash.value = flash;
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}
