# Putting Neon Horizon on itch.io

## 1. Build the upload

```bash
cd neon-horizon
npm run itch
```

Upload **`dist/neon-horizon-itch.zip`** (about 240 KB). Rebuild after any change to the game.

## 2. Project settings on itch

**Create new project** on itch.io, then:

| Setting | Value |
|---|---|
| Kind of project | **HTML** |
| Uploads | the zip, with **"This file will be played in the browser"** ticked |
| Viewport dimensions | **1280 × 720** |
| Frame options | tick **Fullscreen button** |
| Mobile friendly | leave **off**. It needs a mouse, a controller or a VR headset. |
| Automatically start on page load | off. Players click to start, which also unlocks audio. |
| SharedArrayBuffer support | off (not needed) |
| Pricing | your call. "No payments" or "Name your own price" suits a jam game. |
| Visibility | **Draft** first, test it on the real page, then Public |

**Suggested tags:** synthwave, shooter, arcade, vr, webxr, retro, neon, score-attack, browser

**Cover image:** a screenshot of the sun boss or the title screen at 630 × 500. Grab one while playing with `Win+Shift+S`.

## 3. Test the draft before going public

1. **Desktop:** click in, pointer lock grabs the mouse, shoot a mode button, play.
2. **Xbox controller:** press a button first, then right stick and RT.
3. **Quest browser:** open the itch page and press the VR button.
   - If it says **ENTER VR**, itch's frame allows VR. Done.
   - If it says **OPEN FULL PAGE FOR VR**, press it. The game opens on its own page, where Enter VR works.
   - None of this has been tried on a real headset yet, so check it before telling people it works in VR.

## 4. Page copy (paste and edit)

**Title:** Neon Horizon

**Short description:** Shoot everything that falls. A synthwave arcade shooter where the sun is the boss. Play in the browser or in VR.

**Description:**

> Neon meteors fall from every direction. Shoot them before they hit the grid.
>
> Then the sun rises, and it's the boss. Burn it out, watch it go supernova, and chase what's left across the sky: shards, pulsars, a nebula collapsing into a brand new star.
>
> **Modes**
> - **Endless:** shields never run out. Just play.
> - **Normal:** 10 shields, and green pickups refill all of them.
> - **Hardcore:** 10 shields, no repairs.
>
> **Pickups** fly past along the road. Shoot one to grab it: orange rapid fire, purple shotgun, yellow orb, green shields. Weapons last 15 seconds.
>
> **Controls**
> - **Mouse:** click to grab the mouse and look around. Click for a laser, hold for a rainbow beam. A/D turns. M mutes. Esc lets go.
> - **Xbox controller:** press any button first. Right stick looks, RT fires.
> - **VR (Meta Quest browser):** press Enter VR. Trigger fires with either hand.
>
> Built in a week of game jams with three.js and WebXR. No downloads, no installs.
>
> *Local co-op for up to four players runs from the source on your own network. The itch version is single-player.*

## Notes

- **Co-op isn't available on itch.** It needs the small relay server in `serve.js`, and itch only hosts static files. The game notices there's no relay and plays solo without errors.
- **Test flags work on itch too.** Add them to the game's own frame URL, for example `?god` for infinite shields or `?lives=3`.
