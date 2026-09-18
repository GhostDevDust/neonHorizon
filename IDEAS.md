# Ideas

**Deadline: game night, week of 2026-09-16.** Co-op is must-have. The order of
work is at the bottom under *Plan for the week*; the short version is that co-op
goes early because it is the biggest unknown, and the boss goes late because it
is the most cuttable.

Queued work and things worth trying, with the reasoning that came with them so
they can be picked up cold.

## Built for game night (2026-09-13, later)

The boss became the life of a star across three encounters: sun → black hole →
three shards left hanging; shards → pulsars → a nebula left hanging; nebula →
collapse → darkness → a new sun in a new colour. Flares made much bigger. The
held blaster became a rainbow beam. Meteors slowed right down.

Then, after playtesting: Fur Elise was replaced by a crack and a deep rumble -- it read as silly rather than
eerie -- so the notes below about it are history. The boss sun hangs higher, clear of the horizon; the
three shards fly a third of the way round the sky from each other; the beam hum became a soft chord.

## Built for game night (2026-09-13)

Revised the same day after playtesting: the sun no longer eats away from the
bottom as a health bar -- it keeps its shape and burns out to a dark ember with
a corona of solar flares that grows wilder as it is hurt. Normal meteors stop
entirely during the boss, and meteors grow in from a speck instead of appearing
at full size.


Xbox controller for P2, powerups (health, rapid fire, shotgun, orb), and the sun
boss with world recolouring. Everything below marked as queued that concerns
those is done; what remains open is the Titan, changing the direction of travel,
and the headset checkpoint -- which has still not happened.

## Queued

### Two foundations everything else sits on

Both tiny, both blocking, and worth doing before anything on this list:

1. **Direction and speed on a target**, instead of a single downward number.
   Unlocks powerups flying past, thrown meteors, and the orb. Straight lines
   throughout -- no gravity, no arcs. Costs nothing at runtime: three
   multiply-adds per object per frame instead of one.
2. **Hit points and damage**, instead of dying to any hit. Right now "does more
   damage" has nothing to mean. Unlocks boss meteors that take several hits, the
   Titan, and any difference between the weapons.

Together maybe an hour. Everything after them is additive.

### Rules change: shoot everything, pink becomes the reward

Bombs go away. Everything falling from the sky, and everything the Titan throws,
has to be shot. Pink stops meaning "do not shoot" and starts meaning "powerup".

What this costs, stated plainly so it is a choice and not an accident: the
do-not-shoot bomb is currently the game's *only* decision. Take it out and what
is left is pure reaction -- no discrimination, no hesitation, no mistakes of
judgement, only mistakes of aim.

What it buys is worth more. "Shoot everything" is a rule you can hand to a party
guest in three words with the headset already on their face, and that handoff is
what this whole build is for. It also stops punishing the failure mode people
actually have in VR, which is firing at the thing they just noticed.

And the decision comes back in a better shape. A powerup that flies past you in
a narrow window is an *opportunity cost* -- break off the meteors now and risk
one landing, or let the weapon go by. That is a more interesting question than
"is this one pink", and getting it wrong feels like a missed chance instead of a
punishment.

**Powerups fly past horizontally, not down.** The grid already rushes at the
player at speed; the world is implicitly moving. Powerups riding that same axis
-- out of the horizon, past your head, gone -- read instantly as something you
are driving past, and the short window is what creates the urgency. Missing one
costs nothing but the powerup.

Mechanically this is the falling-target mechanic with a different direction:
constant speed, straight line, no arc. Nothing here needs physics.

**One colour each**, so the pickup tells you what you got before you have it:

| Colour | Powerup |
|---|---|
| green | health |
| yellow | heavy orb |
| purple | shotgun |

Two of those collide with the scenery, which is worth knowing before it looks
broken: **yellow** is already the laser and the banded sun, so a yellow powerup
crossing the horizon will disappear into it, and **purple** is the far grid and
the violet mountain ridges. Green is clean -- acid green appears nowhere in the
scenery, and green-for-health needs no explanation.

The fix is not to change the colours but to give every powerup a **shared shape
and motion signature** -- distinct silhouette, pulsing, a trail. Then the form
says "powerup" and the colour only says which one, and a hue briefly matching
the background stops mattering. They should read as "grab this", never as
"destroy this", even though grabbing means shooting.

Fallout to handle: `bombChance` and the letting-a-bomb-land scoring come out,
the shield loss stays on cyan targets reaching the ground, and the idle screen's
"let the PINK ones land" line becomes wrong and has to change with it.

### The boss: the sun rises and rains

Something with stakes, and not a humanoid -- a walk cycle needs a skeleton and
animation data this project does not have, and a figure built from many
separately-drawn chunks is the likeliest thing here to cost real framerate.

**It stays in the sky and throws.** No rolling, no ground traversal. It rises
off the horizon, comes close enough to hit, hangs there, and rains meteors. The
pressure is volume, not a countdown.

**The rise is a ceremony, and the ceremony is the telegraph.** The boss
announces itself: Fur Elise starts, a gentle vibration comes up through the
controllers, and the sun climbs off the horizon. Two or three seconds of that is
warning enough to reposition, and it makes the arrival an event rather than a
spawn. Delicate classical against a synthwave massacre is exactly the right kind
of wrong.

Fur Elise is public domain, and since the audio here is synthesised rather than
sampled there is no recording copyright either -- so the boss fight, which will
be the best footage in the game, cannot be claimed or muted on YouTube. A
licensed track would lose precisely the clip worth posting.

**It has to come closer to be fightable.** The sun sits 300 units out today and
hitscan reaches 60. Rising should mean rising *and* approaching -- down to forty
or fifty units, hanging low and huge over the grid. Still "in the sky", but now
something you can hit, and imposing at that size.

That also gives the world a front again, which 360 spawning took away. In co-op
it splits the job without a word: one player anchors on the sun, the other
covers the rest of the sphere.

**The bands are the health bar.** The sun is drawn as horizontal colour bands
already. Let damage eat them away from the bottom up, so every hit visibly
consumes the sun itself. No health bar to draw, no UI, and the thing you are
shooting *is* the readout. That is the multi-hit feedback problem solved for
free -- the one that otherwise makes every big enemy feel like broken aim.

**Its meteors are a tier above.** Two-tone -- black and orange, pink and orange
-- so they read as "this came from that". Several hits each rather than one, and
worth more than a single shield when they land.

Nearly free to build: a target is already a dark core inside a coloured
wireframe, so a boss meteor is a palette swap of what exists. And now that
everything gets shot, colour is finally free to mean *tier* instead of
shoot-or-do-not, which is a better use of it when the sky is crowded.

**Kill it and another rises in its place, a different colour** -- and the new
sun's colour drives the whole world. Sky, grid and ridgelines are shader
uniforms already, so recolouring the entire scene to match is nearly free. That
is a level system with no level design, and progression the player feels rather
than reads: each sun faster and heavier than the last, the world escalating
visibly with it.

Amber, then magenta, then violet, then something white-hot when it is getting
genuinely unfair.

Death is the payoff shot: the last band goes, the core goes up, the shrapnel
chain takes everything near it, and the next sun begins to rise. Spend the
particles here.

### Three weapons

All small. The orb is the only one needing anything that does not exist.

- **Rapid fire** -- there is no fire-rate limit today, shots simply fire on the
  trigger event. This is auto-fire while held, at N per second. Ten lines.
- **Shotgun** -- several rays per pull with angular jitter, each through the
  existing `pickTarget`, several beams drawn. Fifteen lines. It pairs well with
  the shrapnel chains: one pull can seed several blasts at once.
- **Orb** -- one thicker beam that travels visibly slower and hits harder. The
  only one that needs a travelling projectile rather than an instant hit, which
  is the direction-and-speed refactor being done first regardless.

Acquired by shooting the powerups that fly past.

### The Titan

A giant meteor falls slowly and takes many hits. Kill it in the air and it
bursts and nothing lands. Fail and it hits the ground hard -- with shrapnel
chains in, the impact detonates everything near it -- and stands up as something
that walks at the players. Damage carries over between phases, so shooting it
early is never wasted, it only changes which phase you spend it on.

It walks **slowly**. It is a timer, not a chase, and when it arrives the cost
has to be severe, because there is no locomotion in this game and damage is the
only counter the player has.

**Six pieces, no skeleton.** Head, torso, two arms, two legs, as separate
wireframe solids in the existing visual language, with the legs swinging on a
sine offset and the whole body bobbing. That is a walk cycle in about five lines
and no animation data at all. A dozen draw calls, not fifty -- the expensive
version is the detailed one nobody asked for, and blocky suits the aesthetic
better anyway. Chunks can break off as damage feedback.

**The wind-up: it drags an arm through the ground.** A second or two of low
earthquake rumble, then it scoops the earth and throws three chunks at the
players. Shootable on the way in, so the attack is a skill check rather than a
tax on your shields.

The rumble matters because it is **audible**. Targets come from every bearing
and in co-op the cameras are independent, so the Titan is often behind somebody
-- a wind-up you can only see is one half the table misses. Pan it so direction
is legible, and pulse it into the Quest haptics and P2's pad.

It also answers where the thrown chunks come from: they are the ground, so they
can use the terrain material that already exists, and the drag can leave a scar
across the neon grid.

Rhythm: walk, wind up, throw, recover -- and the recovery is the punish window,
core exposed, bonus damage. A boss that only closes distance is a countdown; a
boss with a loop is a fight.

## Local co-op: second player on a pad, on the PC

VR player in the headset, second player on the TV with an Xbox pad.

**Independent cameras, not a shared view.** Once P2 renders their own view, the
camera is theirs, and letting them look where they want is *less* work than
pinning them to P1's frame: the flat-screen 360 look already in `main.js` is
P2's controller, with stick input in place of the mouse. No screen-space
clamping, no offset maths.

It also turns the 360 blind spot into the co-op mechanic. "You take the front, I
have behind us" is a real division of labour, because things genuinely fall from
everywhere. A rail gunner gets bored; someone who owns a direction does not.

What that costs: a room watching the TV no longer sees what the headset sees,
which is what onlookers want. That is a toggle, not an architecture decision --
a button that snaps P2's camera to P1's head pose and back. Free camera when
someone is playing P2, locked spectator view when nobody is.

Design notes:

- P2's crosshair and beam need a fixed distinct colour. The random-neon-per-shot
  rule has to become P1-only or nobody can tell whose shot did what.
- **No gaze indicator.** Considered and dropped: the sun is a fixed landmark and
  the grid scrolls in a fixed direction, so the world already tells both players
  which way they are facing. "Behind the sun" is a thing one player can say to
  the other without any UI for it. Landmarks beat widgets.
- **Separate scores and separate combos, shared shields.** Cooperative to
  survive, competitive to win: a target reaching the ground hurts both of you,
  but the points are yours. That is the better dynamic between two friends on
  one couch.
- **Last hit takes the kill.** Once targets have hit points, two players can
  damage the same one, and with separate scores that needs an answer. Arcade
  convention, and the kill-stealing it causes is a feature here, not a bug.
- Xbox rumble is available through the Gamepad API's vibration actuator, so P2
  gets the hit feedback the Quest controllers give P1.
- **One authority for target lifecycle.** Two shooters plus shrapnel chains will
  otherwise double-kill and desync cascades. P1's headset owns the target list;
  P2 reports "I hit target 7" and P1 decides. On a LAN a stolen kill is
  invisible.

**The constraint is P2's display, not P2's input.** Even if the pad pairs to the
headset and the Gamepad API sees it inside an immersive session, P2 still has to
look at something, and the only option there is Quest casting -- half a second
to a second behind. Fine for spectating, unusable for aiming. So P2 needs their
own rendered view, which means the PC, which means networking either way.

Wiring, therefore:

**P2 on the PC, pad on the PC, WebSocket relay in `serve.js`.** Fifty to eighty
lines. P1's headset is authoritative and broadcasts at about 20Hz: the target
list, score/lives/combo, explosion events, and both players' shots so each sees
the other's beams. A dozen targets is roughly 200 bytes. P1's head pose goes
across too, but only to draw the "where are they looking" indicator. P2 renders
its own camera and draws its crosshair and beam locally, so aiming has no input
lag; only the world lags, by a few milliseconds on a LAN. P2 resolves its own
hits and tells P1 which target died. Trusting the client is normally wrong and is exactly right
here: nobody cheats at a party game, and it buys instant feedback.

Free with that: the PC screen becomes a spectator view for the room, and the
clean angle to record.

If the buddy is remote rather than in the room, the architecture is unchanged;
the relay just has to be reachable. A Cloudflare Tunnel from the PC gives a
public HTTPS URL, and kills the self-signed certificate warning as a side
effect. Internet latency of 30-80ms is absorbed well by this design, because the
part that has to feel instant is rendered locally.

`gamepad-probe.html` reports, from inside the headset, whether a paired pad
survives entering an immersive session. Worth running -- not because co-op
depends on it any more, but because a yes makes a decent seated single-player
control scheme.

## Plan for the week

Co-op early, because it is the biggest unknown and unknowns belong at the front
of a deadline. Bosses late, because they are self-contained and can absorb
whatever time is left.

1. **The two foundations**, then the rules change, powerups, and rapid fire and
   shotgun -- all of which are small once the foundations exist.
2. **Co-op sync**, tested in two browser windows on the PC.
3. **Headset checkpoint**, mid-week, on the real device: performance, comfort,
   and PC-to-Quest co-op. Nothing in this repo has run on a Quest yet. Whatever
   fails here gets cut while there is still time to cut it.
4. **The sun boss.** Then **the Titan**, then the orb if it has not landed yet.
5. **The day before: fixes only.** No new features.

Build a quality toggle in early -- particle count and effect density behind a
URL flag -- so a headset with no headroom is a setting rather than an emergency.

## Changing the direction of travel

The grid scrolls toward the player at a fixed heading, so the world implies
driving forward forever. The idea is to change that heading during a run.

Cheap to build, because nothing actually moves: the player is stationary and the
world is procedural. A single heading angle read by the grid shader and the sun's
position turns the whole world, and the mountains are already a full ring.

What it buys: the 360 space gets a *changing* front. Both players have to
re-orient together, and since the sun is the landmark they navigate by, moving
it is the strongest possible way to say "everything you knew about which way is
which is now wrong".

**The catch is VR comfort, and it is a serious one.** Rotating the world around a
stationary player is a worse nausea trigger than moving them through it -- the
eyes report a turn the inner ear does not. The comfort design is the reason this
game is safe to hand to a stranger at a party, and a slow world rotation would
throw that away.

The version that survives the objection: **snap, do not turn.** Change heading as
a hard cut during a discrete event -- between waves, or as a new sun rises -- and
never as a smooth rotation. Cuts do not cause sickness the way slow rotation
does, and a sudden reorientation is more dramatic anyway. Worth prototyping on
the flat screen first, and testing in the headset before trusting it.

## Fixed: dark halo around the crosshair (2026-09-13)

Stars near the crosshair were washed out while stars at the edges stayed crisp,
and the effect followed the view around.

Cause: `scene.fog` is linear from 140 to 480 and the stars sit at radius 420 --
but three.js fogs by **view-space depth**, not radial distance. A star straight
ahead is ~420 deep and 82% faded into the fog colour; the same star 60 degrees
off-axis is 420*cos(60) = 210 deep and barely touched. That is a radial wash
centred on the view direction, which is exactly what a halo following the
crosshair looks like.

Fix: `fog: false` on the star material in `src/scenery.js`. Stars are meant to
read as infinitely far away, so they should never have been fogged.

Measured before and after, brightest star pixel in a 260x200 patch: centre went
from 64 to 179 while the edges stayed at ~110 and 180 -- uniform across the
frame afterwards, where before the centre was less than half the periphery.

Two wrong turns worth remembering. Averaging a crop to one pixel measures the
*sky*, not the stars -- stars are a fraction of a percent of the area, so the
before/after numbers came out identical and looked like the fix had failed.
And an isolation test that set `fog = null` alongside three other changes hid
the answer in plain sight for an hour.
