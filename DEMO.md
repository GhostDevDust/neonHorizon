# Demo cheat sheet

## Start the server

```bash
cd neon-horizon
npm start
```

It prints the addresses when it starts. **Trust what it prints over this file** —
the LAN address comes from the router and changes (it has been `.1.2`, `.1.5`
and `.1.6` so far).

## URLs

| Who | URL |
|---|---|
| **This PC — open first** | `https://localhost:8443/?host` |
| Second window on this PC | `https://localhost:8443/` |
| Headset, laptop, anything on the wifi | `https://192.168.1.5:8443/` |

Up to four players. First tab with `?host` owns the world — make that the PC,
not the headset, so nobody lifting the headset off pauses everyone.

## Flags

Add to the end of any URL. Combine with `&`, e.g. `?host&god`.

| Flag | Does |
|---|---|
| `?host` | Make this tab the host |
| `?god` | Shields never run out in any mode (HUD shows TEST MODE) |
| `?lives=9` | Start with a different number of shields, whatever the mode |
| `?classic` | The game as it was at the start of the last session — before/after footage |

## Before you hand it to someone

- **Hard-reload tabs left open from earlier** — Ctrl+Shift+R. Old tabs run old code.
- **Other devices show a certificate warning** the first time: Advanced → Proceed.
- **Two windows on one machine:** press `M` in one, or the audio doubles up.

## Controls

**Desktop:** click once to grab the mouse, look anywhere. **Click** for a single laser, **hold** for a rainbow beam.
`A`/`D` or arrow keys turn. `M` mutes. `Esc` releases the mouse.

**Xbox controller:** right stick looks (left stick also turns), RT fires — A and
RB fire too. **Press any button once first**: browsers hide a pad until it has
been used. Input only reaches the focused window, so click into the game window
before handing someone the pad.

**VR:** trigger fires, either hand. Holding it keeps firing while you have rapid fire.

## What's in a run

- **Shoot a mode to start:** **Endless** (shields never run out) · **Normal**
  (10 shields, green pickup refills them all) · **Hardcore** (10 shields, no
  health pickups). In co-op anyone can pick; it starts for everyone.
- **Other players are neon outlines** standing beside you, and their lasers and
  beams come from them. Shoot straight through them.
- **Shoot everything that falls.** Anything reaching the ground costs a shared shield.
- **Powerups fly past along the road** — shoot one to take it.
  Green = shields refilled (normal mode) · orange = rapid fire · purple = shotgun · yellow = orb.
  Weapons last 15 seconds and belong to whoever shot the pickup.
- **The boss is a star's life, in three encounters** with meteor stretches between:
  1. **The Sun** rises to a crack and a deep rumble, hangs high in the sky
     throwing meteors, darkens and flares as you hurt it — then collapses, goes
     supernova, becomes a black hole and **breaks into three shards that fly to
     different parts of the sky** (two are behind you) and stay there, far out.
     Shots at anything that far become bolts you watch fly there.
  2. Later, the shards tremble into **three pulsars** with sweeping lighthouse
     beams. Kill all three and they drift together into a **nebula** that stays
     in the sky.
  3. Later still, the **nebula** wakes up. Shooting it makes it contract into a
     glowing spiral until it collapses, the world goes black, and a **new sun
     rises in a new colour**. Then it starts again.
