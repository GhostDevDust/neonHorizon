// Tweak everything here. Colors are hex ints so they drop straight into three.js.

export const PALETTE = {
  skyTop:       0x090018,
  skyGround:    0x07000f,
  skyMid:       0x3b0a52,
  skyHorizon:   0xff2975,
  sunTop:       0xffd319,
  sunMid:       0xff8a3d,
  sunBot:       0xff2975,
  gridNear:     0x00f0ff,
  gridFar:      0xb026ff,
  ridgeFar:     0xb84dff,
  ridgeNear:    0x00f0ff,
  mountainFill: 0x0d0022,
  target:       0x00f0ff,
  targetCore:   0x120033,
  bomb:         0xff2975,
  beam:         0xffd319,
  particle:     0xffd319,
};

// Every shot picks one of these at random. Kept deliberately saturated and
// bright -- muddy colors read as grey against the dark ground.
export const NEON = [
  0x00f0ff, // cyan
  0xff2975, // hot pink
  0xffd319, // yellow
  0xb026ff, // violet
  0x39ff14, // acid green
  0xff6b00, // orange
  0xff00ff, // magenta
  0x00ff9f, // spring
];

export const CFG = {
  // --- scenery ---
  gridSpeed:     10,      // how fast the floor rushes at you
  gridCell:      2.5,
  gridFade:      150,     // distance where the grid dissolves

  // --- difficulty ramp ---
  rampSeconds:   100,     // time to reach max difficulty
  spawnStart:    1.7,     // seconds between spawns at t=0
  spawnMin:      0.5,
  // Fall speed is a staircase, not a ramp: it holds steady, then steps up.
  // A change you can hear and see is easier to read than a creeping drift.
  // Playtested 2026-09-13: at the old 1.7 + 0.55/step, meteors were too fast to
  // hit by the one-minute mark. Now 1.8 at 60s, 2.6 at two minutes.
  fallStart:     1.0,     // units/sec at t=0 -- about 13s to fall from the top
  speedStep:     0.2,     // units/sec added at each step
  speedEvery:    15,      // seconds between steps
  fallMax:       4.2,     // staircase stops here (~4 minutes in)

  // --- rules ---
  lives:         5,
  spawnHeight:   13,
  spawnRadius:   9,       // targets land within this radius of the player
  // Radians of arc used for spawns, centred on the player's starting facing.
  // Full circle: things come from behind you too, so you have to look around.
  // Drop it to ~2.4 for a frontal-only arc if you want a seated/no-turn demo.
  spawnArc:      Math.PI * 2,
  targetRadius:  0.42,
  targetHp:      1,       // shots to kill a plain target; boss meteors take more
  hitPadding:    0.28,    // generous aim assist -- it is a party demo

  // --- shrapnel ---
  // A burst stays hot for a moment and sets off anything that drifts into it,
  // which is what makes a well-placed shot cascade down a column of targets.
  blastLife:     2.1,     // seconds a burst lingers on screen
  blastLethal:   0.55,    // fraction of that life it can still detonate things
  blastRadius:   1.5,     // metres -- roughly three target widths
  blastPoints:   0.5,     // chain kills score this fraction of a clean hit
  blastDamage:   1,       // damage a blast deals -- tough things can survive one

  // --- before/after footage ---
  // Set by ?classic. A rolling baseline: the game as it stood at the start of
  // the current session, so the same thirty seconds can be captured twice and
  // cut against itself.
  //
  // The rule when changing the game: guard the new behaviour behind
  // `!CFG.classic` so ?classic still gives the old one. At the start of the
  // next session, fold those guards away -- ?classic means "before today"
  // again, and the code only ever carries one session of branches.
  classic:       false,

  // --- powerups ---
  // They come at you along the road, like something you are driving past.
  powerupEvery:  11,      // seconds between powerups, on average
  powerupJitter: 4,       // +/- that much, so they are not a metronome
  powerupSpeed:  11,      // metres/sec toward the player
  powerupStartZ: -75,     // where they appear, out toward the horizon
  powerupEndZ:   14,      // where they are gone, past your shoulder
  weaponSeconds: 15,      // how long a weapon powerup lasts

  // --- the sun boss ---
  bossFirst:      40,     // seconds into a run before the first sun rises
  bossEvery:      55,     // seconds between one sun going back and the next rising
  bossRise:       4.5,    // the ceremony: Fur Elise, a rumble, the climb
  bossDark:       3.5,    // how long the world stays black after the last shard
  bossDawn:       9,      // light breaking, and the new sun rising
  bossHp:         24,     // shots to kill the first sun...
  bossHpPerLevel: 10,     // ...and this many more for each one after
  bossThrowEvery: 2.8,    // seconds between volleys of three
  bossThrowSpeed: 7,
  // Where it hangs while you fight it: high enough that its lower edge sits
  // well clear of the mountains, rather than sitting on the horizon.
  bossY:          30,
  bossZ:          -55,
  bossScale:      0.32,
  bossSpawnScale: 0,      // meteors stop while the sun is up -- it is the fight
  bossPoints:     15,     // a kill is worth this many clean hits

  // --- the broken sun ---
  shardCount:      3,    // the sun breaks into three, which become three pulsars
  shardHpFraction: 0.45, // each pulsar's hit points, as a share of its sun's
  shardScale:      0.8,  // relative to the whole sun's fight size
  // The pieces fly out to different parts of the sky -- a third of the way
  // round the player each -- so no two are ever close together.
  // Far enough out to feel like part of the sky rather than something beside
  // you. Shots at them fly out as bolts, so the distance reads.
  shardDistance:   85,   // metres from the player
  shardElevation:  0.5,  // radians above the horizon, about 29 degrees
  shardThrowEvery: 3.4,  // seconds between each pulsar's meteors
  shardPoints:     6,    // per pulsar
  pulsarSize:      15,   // the glowing core, in metres
  pulsarHitRadius: 6,    // forgiving: at that range the core is a small target

  // --- the nebula ---
  nebulaSize:       80,  // metres across while it hangs in the sky
  nebulaDistance:   100, // metres from the player
  nebulaHpFraction: 1.2, // as a share of the sun's hit points
  nebulaThrowEvery: 3.0,
  nebulaPoints:     15,

  // --- testing ---
  // Turned on per-window by adding ?god to the URL, so a test client and a
  // normal one can run side by side without editing anything. The HUD says so
  // when it is on -- a cheat you forget you enabled is a bug report later.
  infiniteLives: false,

  // --- scoring ---
  pointsBase:    100,
  comboStep:     0.25,    // each consecutive hit adds this multiplier
  comboMax:      5,
};

// --- game modes ---------------------------------------------------------------
// Picked on the title screen by shooting one. Every mode plays the same run;
// they differ only in how forgiving the shields are.
//   infinite  shields never run out
//   repair    what the green health pickup does: 'full' refills every shield,
//             'none' means it never turns up at all
export const MODES = {
  endless:  { label: 'ENDLESS',  blurb: 'shields never run out',   lives: 10, infinite: true, repair: 'none', color: 0x00f0ff },
  normal:   { label: 'NORMAL',   blurb: '10 shields, green refills', lives: 10, repair: 'full', color: 0x39ff14 },
  hardcore: { label: 'HARDCORE', blurb: '10 shields, no repairs',  lives: 10, repair: 'none', color: 0xff2975 },
};
export const MODE_ORDER = ['endless', 'normal', 'hardcore'];

// Fall speed for a target spawned `elapsed` seconds into the run.
export function fallSpeedAt(elapsed) {
  const steps = Math.floor(elapsed / CFG.speedEvery);
  return Math.min(CFG.fallMax, CFG.fallStart + steps * CFG.speedStep);
}

