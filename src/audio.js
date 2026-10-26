// Every sound here is synthesised at runtime with WebAudio.
// No audio files, no licensing, nothing to download.

let ctx = null;
let master = null;
let musicGain = null;
let seqTimer = null;
let step = 0;
let muted = false;   // remembered, so M before the first click still counts
const VOLUME = 0.55;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : VOLUME;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.0;
  musicGain.connect(master);
  return ctx;
}

// Everything the speakers get, as a MediaStream for the Share clip recorder
// (share.js). Null until the first gesture has made the context.
let tap = null;
export function audioStream() {
  if (!ctx) return null;
  if (!tap) {
    tap = ctx.createMediaStreamDestination();
    master.connect(tap);
  }
  return tap.stream;
}

function env(node, peak, attack, decay, t0) {
  const g = node.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(peak, t0 + attack);
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}

// Descending saw zap.
export function sfxLaser() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(4000, t);
  filt.frequency.exponentialRampToValueAtTime(600, t + 0.16);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1400, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.16);
  env(gain, 0.25, 0.005, 0.16, t);
  osc.connect(filt).connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.22);
}

// Filtered noise burst. The noise is made once and reused: rapid fire and a
// cascade call this many times a second, and a fresh 0.4 s buffer each time
// is garbage the Quest has to collect mid-fight.
let explodeBuf = null;
export function sfxExplode(pitch = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (!explodeBuf) {
    const len = Math.floor(ctx.sampleRate * 0.4);
    explodeBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = explodeBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  const src = ctx.createBufferSource();
  src.buffer = explodeBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = 1.2;
  filt.frequency.setValueAtTime(1800 * pitch, t);
  filt.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.35);
  const gain = ctx.createGain();
  env(gain, 0.45, 0.004, 0.34, t);
  src.connect(filt).connect(gain).connect(master);
  src.start(t);
}

// A shot glancing off a boss that cannot be hurt yet: a short, dull ping,
// quiet enough to sit under a held beam ticking six times a second.
export function sfxDeflect() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, t);
  osc.frequency.exponentialRampToValueAtTime(380, t + 0.09);
  env(gain, 0.07, 0.003, 0.09, t);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.12);
}

// Low descending "you let one through".
export function sfxMiss() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + 0.5);
  env(gain, 0.22, 0.01, 0.5, t);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.6);
}

// Bright confirmation blip.
export function sfxBlip(freq = 660) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  env(gain, 0.18, 0.005, 0.14, t);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.2);
}

export function sfxGameOver() {
  if (!ctx) return;
  const notes = [440, 349, 293, 220];
  notes.forEach((f, i) => {
    const t = ctx.currentTime + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, t);
    env(gain, 0.2, 0.01, 0.4, t);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + 0.5);
  });
}

// --- background music: a 16-step minor arpeggio + kick, the cheapest
// possible synthwave. Runs on a JS interval so it survives XR frame stalls.
const ROOT = 55; // A1
const PATTERN = [0, 7, 12, 15, 12, 7, 3, 7, 0, 7, 12, 19, 15, 12, 7, 3];

function note(semi, t, dur) {
  const freq = ROOT * Math.pow(2, semi / 12);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(1600, t);
  filt.frequency.exponentialRampToValueAtTime(400, t + dur);
  osc.type = 'sawtooth';
  osc.frequency.value = freq * 4;
  env(gain, 0.12, 0.01, dur, t);
  osc.connect(filt).connect(gain).connect(musicGain);
  osc.start(t);
  osc.stop(t + dur + 0.05);

  // sub bass on the downbeats
  if (step % 4 === 0) {
    const b = ctx.createOscillator();
    const bg = ctx.createGain();
    b.type = 'sine';
    b.frequency.value = freq;
    env(bg, 0.3, 0.01, 0.3, t);
    b.connect(bg).connect(musicGain);
    b.start(t);
    b.stop(t + 0.4);
  }
}

export function startMusic() {
  if (!ctx || seqTimer) return;
  musicGain.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2);
  const stepMs = 150;
  seqTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    note(PATTERN[step % PATTERN.length], ctx.currentTime, 0.24);
    step++;
  }, stepMs);
}

export function stopMusic() {
  if (seqTimer) { clearInterval(seqTimer); seqTimer = null; }
  if (musicGain && ctx) musicGain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.4);
}

export function setMuted(on) {
  muted = on;
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.1);
}

// --- an omen: a crack, then a deep rumble -----------------------------------
// Played when the sky is about to do something -- the sun coming off the
// horizon, shards trembling into pulsars, the nebula waking. A sharp crack like
// something splitting far away, then a rumble felt more than heard, swelling
// for `seconds` and dying away.
export function sfxOmen(seconds = 4) {
  if (!ctx) return;
  const t = ctx.currentTime;

  // The crack: a short, bright burst of noise with a quick resonant snap.
  const crackLen = Math.floor(ctx.sampleRate * 0.18);
  const crackBuf = ctx.createBuffer(1, crackLen, ctx.sampleRate);
  const cd = crackBuf.getChannelData(0);
  for (let i = 0; i < crackLen; i++) {
    const k = i / crackLen;
    cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 5);
  }
  const crack = ctx.createBufferSource();
  crack.buffer = crackBuf;
  const crackHp = ctx.createBiquadFilter();
  crackHp.type = 'highpass';
  crackHp.frequency.value = 900;
  const crackBand = ctx.createBiquadFilter();
  crackBand.type = 'peaking';
  crackBand.frequency.value = 2600;
  crackBand.Q.value = 3;
  crackBand.gain.value = 9;
  const crackGain = ctx.createGain();
  crackGain.gain.value = 0.55;
  crack.connect(crackHp).connect(crackBand).connect(crackGain).connect(master);
  crack.start(t);

  // The rumble: brown noise through a low-pass, swelling then fading, with a
  // sub-bass tone underneath that slowly sags in pitch.
  const len = Math.floor(ctx.sampleRate * (seconds + 1.5));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  const rumble = ctx.createBufferSource();
  rumble.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(90, t);
  lp.frequency.linearRampToValueAtTime(180, t + seconds * 0.7);
  lp.frequency.linearRampToValueAtTime(70, t + seconds + 1.4);
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0.0001, t);
  rg.gain.exponentialRampToValueAtTime(0.9, t + seconds * 0.6);
  rg.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 1.4);
  rumble.connect(lp).connect(rg).connect(master);
  rumble.start(t + 0.05);

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(46, t);
  sub.frequency.exponentialRampToValueAtTime(31, t + seconds + 1.2);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(0.32, t + seconds * 0.6);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 1.3);
  sub.connect(sg).connect(master);
  sub.start(t);
  sub.stop(t + seconds + 1.5);
}

// The held beam: a soft shimmering chord for as long as it is on. It plays
// continuously while held, so it has to be something you can listen to for a
// while -- pure sines a fifth apart with a slow shimmer, kept quiet and
// low-passed, rather than anything with a buzz in it.
let beamVoice = null;
export function beamStart() {
  if (!ctx || beamVoice) return;
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.045, t + 0.15);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1500;
  const shimmer = ctx.createGain();
  shimmer.gain.value = 1;
  const oscs = [];
  for (const f of [392, 587.3, 784]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const og = ctx.createGain();
    og.gain.value = f > 700 ? 0.35 : 1;
    o.connect(og).connect(shimmer);
    oscs.push(o);
  }
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 3.2;
  lfoGain.gain.value = 0.25;
  lfo.connect(lfoGain).connect(shimmer.gain);
  oscs.push(lfo);
  shimmer.connect(filt).connect(gain).connect(master);
  for (const o of oscs) o.start(t);
  beamVoice = { gain, oscs };
}

export function beamStop() {
  if (!ctx || !beamVoice) return;
  const t = ctx.currentTime;
  const v = beamVoice;
  beamVoice = null;
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(0.0001, t, 0.05);
  for (const o of v.oscs) o.stop(t + 0.3);
}

// The collapse: a rising, tightening rush, like something taking a breath in.
export function sfxCollapse() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = 6;
  filt.frequency.setValueAtTime(180, t);
  filt.frequency.exponentialRampToValueAtTime(3200, t + 0.55);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.55, t + 0.52);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  src.connect(filt).connect(gain).connect(master);
  src.start(t);
  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(60, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.55);
  env(og, 0.25, 0.4, 0.15, t);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.62);
}

// A low, long boom for the sun going out.
export function sfxSunDeath() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(28, t + 1.6);
  env(gain, 0.5, 0.01, 1.6, t);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 1.8);
  for (let i = 0; i < 5; i++) setTimeout(() => sfxExplode(0.5 + i * 0.15), i * 140);
}
