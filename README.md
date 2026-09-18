# Neon Horizon

A retro-synthwave VR shooter for the Meta Quest. Wireframe mountains, a banded
sun on the horizon, a neon grid rushing past your feet, and shapes falling out
of the sky that you shoot with lasers.

Runs in the browser via **WebXR** — no APK, no sideloading, no dev account.
Your friend opens a URL and they're in.

## Zero external assets

Every visual and every sound is generated at runtime:

| Thing | Made from |
|---|---|
| Sky, sun, grid | GLSL shaders |
| Mountains | procedurally generated ridge geometry |
| Targets | icosahedron wireframes |
| Score / title text | 2D canvas drawn to a texture |
| All audio | WebAudio oscillators and noise buffers |

Nothing is downloaded, nothing is licensed, and `vendor/three.module.js` is
committed so the whole thing runs offline. That matters more than it sounds
like it should — venue wifi is unreliable and a CDN dependency is exactly the
thing that dies five minutes before you demo.

## Running it

```bash
npm install     # only needed for the dev server's cert generator
npm start
```

Then:

- **Desktop (quick check):** open `https://localhost:8443/`
- **Quest:** open the `https://192.168.x.x:8443/` address the server prints,
  in the Quest browser, on the same wifi. You'll hit a certificate warning the
  first time — *Advanced → Proceed*. Then press **ENTER VR**.

WebXR only runs in a secure context, which is why the dev server uses TLS with
a self-signed cert rather than plain HTTP.

## Playing

- **Trigger** — fire. Either hand; both are armed. Every shot picks a random
  neon color, and every kill throws a spray of random neons.
- Shoot the **cyan** shapes before they hit the ground. Each one you miss
  costs a shield.
- **Let the pink ones land.** Shooting one costs a shield; letting it through
  is worth points.
- Consecutive hits build a combo multiplier up to 5×. Landing a cyan target or
  shooting a pink one resets it.
- **The sparks are live.** A burst stays hot for about a second and sets off
  anything that falls into it, which sets off *its* sparks, and so on — one
  well-placed shot can walk up a whole column. Chain kills score half a clean
  hit at your current multiplier and don't build the combo; the combo is for
  shots you aimed. A bomb caught in a blast costs no shield (you didn't shoot
  it) but does break the combo.
- **Pick a mode by shooting it** on the title screen (and again after game
  over). A shot anywhere else is just a shot, so you can find your aim first.
  - **Endless** -- shields never run out. No health pickups, since they would do nothing.
  - **Normal** -- 10 shields; the green health pickup refills all of them.
  - **Hardcore** -- 10 shields; health pickups never turn up.

  Modes live in `MODES` in `src/config.js`. `?classic` predates them and keeps
  five shields and pull-the-trigger-to-start.
- Targets fall from **any** bearing, including behind you.
- Speed is a staircase: they start slow and step up every 15 seconds, with a
  rising blip each time, until they cap out around 2:20 in. Spawn *rate* still
  ramps smoothly over the first 100 seconds.

Desktop fallback for testing without the headset: click once to grab the mouse
(pointer lock), then look anywhere — full 360, same as VR — and click to fire.
`A`/`D` or the arrow keys turn, `M` mutes, `Esc` releases the mouse. If pointer
lock is refused or released, the cursor steers instead: push it toward a side of
the screen and the view spins that way, and clicks fire immediately.

There's a crosshair at screen centre, and shots draw a tracer from the lower
right so you can see them land. Targets outside the view get a chevron at the
edge of the screen pointing at them, in their own colour — a monitor's 70
degrees is not enough to track a full sphere of falling shapes without one.

## Comfort

The player never moves. There's no artificial locomotion, no smooth turning,
no acceleration — you stand still and things come to you. That's deliberate:
it's the single biggest reason this design is safe to hand to a party guest who
has never worn a headset. The HUD is world-anchored rather than head-locked for
the same reason.

You do have to turn to face things, physically, which is fine standing in a
clear space and less fine seated or tethered. Set `spawnArc` back to something
like `2.4` for a frontal-arc game if the room or the guest calls for it.

The flat-screen path is the exception to the no-smooth-turning rule — mouse-look
is smooth turning by definition, and it isn't a comfort problem on a monitor.
Its HUD swings round with the view (VR's stays anchored) so turning away from
the start facing doesn't cost you the score and the prompts.

## Tuning

Nearly everything worth changing is in [`src/config.js`](src/config.js) —
colors, fall speeds, spawn rate, difficulty ramp, shield count, hit generosity.

`spawnArc` is the one to reach for if the play space is small — it's the full
circle by default. `hitPadding` is deliberately loose (targets are easier to hit than they look).
Tighten it if your friend is good; loosen it further if people are flailing.

The pace lives in `fallStart` / `speedStep` / `speedEvery` / `fallMax` — a
staircase rather than a ramp, so a target's speed is
`fallStart + speedStep × ⌊t / speedEvery⌋`, capped at `fallMax`.

The chain reaction is `blastRadius` (how far a burst reaches), `blastLethal`
(what fraction of its life it can still set things off), `blastLife` (how long
the sparks hang around at all) and `blastPoints` (what a chain kill is worth
against a clean one). Raising `blastRadius` much past 2 turns every shot into a
screen-clear; that is fun for about a minute.

## Weapons, powerups and the sun

**Weapons** live in `src/weapons.js` as a table. Every weapon is either rays —
resolved the instant the trigger fires — or an orb, a projectile that travels
and can miss because the target moved. The shotgun is simply seven rays with
spread. A ray that reaches the sun, a pulsar or the nebula becomes a **bolt**
you watch fly out there, and the damage lands when it arrives -- an instant hit
on something 60 to 100 metres away reads as if it were at arm's length. Shots
draw after the sky's big pieces, so the sun never paints over a laser. Triggers are down/up rather than click events, so an automatic weapon
keeps firing while held, and the mouse, the Xbox pad and both VR hands all go
through the same path.

**Powerups** are entries in the `KINDS` table in `src/targets.js`, alongside
meteors and the boss's meteors. They fly toward the player along the road
instead of falling, never land, and are exempt from shrapnel — a cascade that
ate the health pack you were lining up would feel like the game cheating. They
share an octahedron-and-ring silhouette so they read as "grab this" even when
their colour matches what is behind them: yellow against the sun, purple
against the far ridge.

**The boss is the life of a star**, told across a whole run in three encounters
(`src/boss.js`, with the pulsars and nebula drawn in `src/stellar.js`). Each
picks up where the last left off, with ordinary meteor stretches between them,
so the pacing of a run stays the same while the sky tells a story. Normal meteors
stop during an encounter and come back between them.

1. **The Sun.** It rises off the horizon to a distant crack and a deep swelling
   rumble, felt through the controllers too, and hangs high over the grid throwing heavy meteors, darkens toward a dull ember as it is
   hurt, and its flares grow huge. Kill it and it collapses, goes supernova, and
   becomes a black hole (`src/supernova.js`) — which breaks it into **three
   shards that streak out to different parts of the sky**, a third of the way
   round the players each, and hang there glowing along their cracks through the
   next meteor stretch. Two of them are behind you; on a flat screen the edge
   arrows point at them.
2. **The Pulsars.** The shards tremble and each collapses into a pulsar: a
   blinding spinning core with twin lighthouse beams sweeping the sky, long
   enough to wash over the players in a headset. Three mini-bosses. Their remains
   drift together into a **nebula that hangs in the sky** through the next
   stretch.
3. **The Nebula.** It stirs and becomes the boss. Damage makes it contract into a
   spiral with a blazing core — you are gravity, sped up — until it collapses to
   a point, the world goes black but for the stars, light breaks in a new colour,
   and a new sun rises from behind the mountains. Then the cycle starts again.

The new sun is not just a reset: it is how stars really form, out of what dead
ones leave behind.

Everything each machine needs to draw the story is in the snapshot — stage,
phase, clock, hit points, where the sun died and the angle it broke along — so
the shards, pulsars and nebula hang in the same places for every player.

The world's colours come from `LEVELS` in `src/scenery.js`, and go black and come
back through a darkness factor. The floor under the grid is an opaque disc
painted with the sky's own shader, so nothing below ground shows through while
the horizon glow still does.

**Fill rate is the thing to watch on a Quest**: the sun's flares, the supernova
flash and shockwave, and the nebula are all large translucent layers. No extra
render passes anywhere — real gravitational lensing would mean rendering the
scene twice — but none of this has run on a headset yet.

Meteors grow in from a speck over their first second or so, and the pace is
slow to start: about 13 seconds to fall at the beginning, 7 at the one-minute
mark.

**Holding the trigger** on the default blaster turns a single laser into a solid
beam that flows through the neon rainbow along its length. It is a camera-facing
ribbon rather than a cylinder: the beam starts beside your eye and runs away
from you, and a cylinder seen that end-on has no side facing the camera to
shade, so it vanished. It deals damage in ticks, hums a soft shimmering chord
rather than anything buzzy, and never uses the explosion pool for its impact
sparks — those bursts are live shrapnel.

## Co-op

Up to four players, separate scores, shared shields. **Cooperative to survive,
competitive to win**: a target reaching the ground costs everyone a shield, but
the points are yours alone.

Open the same URL on as many machines as you like. Anyone on the LAN with a
browser can join -- laptops, a second PC, the headset. Nothing to configure: if
the dev server is running, co-op is on, and if it is not, you are playing solo.

```
https://localhost:8443/?host    open this one FIRST, on the PC
https://localhost:8443/         everyone else, including the headset
```

**Use `?host` on the PC.** It asks the relay to make that tab the world's owner,
so the machine on mains power -- the one nobody lifts off their head mid-game --
does the hosting. Without it the first tab to connect wins, which is usually
fine and occasionally the headset.

The host's browser is authoritative: it spawns targets, owns their hit points,
and decides what died. Clients mirror it and send "I hit target 7" upstream. The
host applies the damage and everyone's scores ride along in the next snapshot.
**Last hit takes the kill** -- with hit points and separate scores, two players
can damage the same target, and the kill-stealing that causes is a feature when
it is two people on a couch. Cascades pay whoever fired the shot that started
them, not whoever happens to be hosting.

What clients never wait for: their own camera, crosshair and beam. Those are
local and instant. Only the world is authoritative, and the world is a few
metres away moving slowly, so a few milliseconds of LAN latency is invisible.

Targets travel in straight lines at constant speed, so a snapshot carries
position and velocity and the client integrates between them -- 20Hz is plenty
and there is no interpolation buffer. Explosions need no protocol at all: a
target that vanishes from a snapshot died on the host, so the client bursts it.

### Seeing each other

Every other player is a **neon outline** in their scoreboard colour, labelled
P1-P4, with a visor that shows where they are looking and a blaster in each
tracked hand (one at the hip for a flat-screen player). Their shots, held
beams and orbs come out of that blaster. It is only a picture: never
hit-tested, so you shoot straight through it.

Everyone really stands at the same point, so a friend drawn where they are
would be inside your head. Instead players stand in a row 1.5 m apart in
scoreboard order: P2 is on P1's right, and P1 is on P2's left. Poses go out at
10Hz (`t:'pose'`), each shot as it happens (`t:'fx'`), a held beam's impact
point at 15Hz. All of it is visual -- damage still goes through `hit`/`bhit`
to the host -- and it lives in `src/ghosts.js`.

### When someone goes away

A hidden tab has its animation frames throttled to about one a second. Left
alone, a host that alt-tabs or sets the headset down would keep running the
world at a twentieth speed and keep broadcasting -- everyone slides into slow
motion with no explanation. Instead the host pauses outright and says so.

If a host stops responding, the relay re-elects. Two mechanisms, because they
catch different failures: a ping/pong catches a genuinely dead socket, and a
keep-alive sent from the render loop catches a *frozen tab*, whose socket looks
perfectly healthy because the browser's network process answers pings on behalf
of a wedged renderer. A promoted client repairs what only made sense as a
client -- id minting, the difficulty tier, the spawn clock -- and keeps
everyone's score, which arrived in the last snapshot.

Clients that hear nothing for two seconds say **waiting for host** rather than
integrating targets through the floor. A dropped connection retries with
backoff, and falls back to solo play rather than a frozen world.

The relay in `serve.js` is deliberately dumb. It hands out ids, says who hosts,
tracks who is still talking, and forwards messages -- every rule lives in
`src/`, so the server never has to be taught the game.

## Testing

Query-string flags, per browser window, so a test client and a normal one can run
side by side:

```
?classic      the build as it stood at the start of the current session
?god          shields never run out (the HUD says TEST MODE so you cannot forget)
?lives=9      start with a different number
```

`?classic` is a **rolling baseline**, not a fixed one. Open it in a second tab,
capture the same thirty seconds in both, and every change has a real before and
after.

Keeping it working is a habit, not a task: when you change how the game behaves,
guard the new behaviour so `?classic` still gives the old one. At the start of
the next session, fold those guards away -- `?classic` means "before today"
again, and the game only carries one session's worth of branches at a time.

`?classic=v0` is the original build kept for reference: frontal spawn arc, the
old clamped mouse look, the smooth difficulty ramp, and single-colour sparks
that fade immediately and set nothing else off. It is the *look and feel* of
that build, not a faithful rebuild -- bombs are gone from the code and are not
coming back.

Two windows on one machine is the fastest way to work on anything involving two
players -- mute one with `M` or you get the audio twice, slightly out of phase.
A laptop on the LAN adds real network timing; the headset adds stereo cost and
comfort, and is worth saving until the mechanics have settled.

The live scene is exposed on `window.__NH` for poking around in devtools.

## Layout

```
index.html          page shell, styles, Enter VR button
serve.js            dev server, generates a self-signed cert on first run
src/config.js       all tunables
src/main.js         renderer, XR session, game state, main loop
src/scenery.js      sky / sun / grid / mountains / stars
src/targets.js      spawner, falling targets, explosion pool
src/weapons.js      controllers, beams, hit detection
src/hud.js          canvas-texture score and title panels
src/offscreen.js    flat-screen edge chevrons for targets out of view
src/audio.js        synthesised sfx and music
vendor/             three.js
```

## Shipping it

It's a static site. Any HTTPS static host works and both of these are free:

- **itch.io** — run `npm run itch` and upload `dist/neon-horizon-itch.zip`.
  Upload settings and page copy are in `ITCH.md`. The build contains only what
  the browser loads, checks every import resolves with exact case (itch's host is
  case-sensitive, Windows is not), and zips with forward slashes.
- **GitHub Pages** — push the folder, enable Pages on the branch.

Real HTTPS means no certificate warning, which is what you want if the headset
is getting passed around.

On a static host there is no co-op relay, so the game tries once, fails quietly
and plays solo. Inside itch's embed frame VR may not be allowed to start; on a
headset browser the button then offers to open the game on its own page, where
it can.

## Performance notes

Quest renders stereo at 72–90fps, so the budget is tighter than it looks. This
build stays cheap on purpose: no post-processing (the neon glow is emissive
colors and additive blending, not a bloom pass), a recycled particle pool
instead of per-explosion allocation, and shared geometry across all targets.

The pool is 20 bursts of 52 sparks — sized so a cascade never has to steal one
that is still on screen. If it ever does, the oldest gets recycled early and the
worst case is a burst that vanishes a little abruptly, not a hitch. The chain
test is one distance check per live burst per airborne target, low hundreds per
frame at worst; it does not need spatial partitioning at this scale.

If you add a bloom pass, measure it before you commit to it — full-scene
post-processing in stereo is the most common way a WebXR scene falls off its
framerate target.
