// Xbox controller for a flat-screen player.
//
// It feeds the same `look` object the mouse does and pulls the same trigger the
// mouse does, so there is one input path with two ways in rather than two
// parallel ones to keep in step.
//
// Browsers hide gamepads until a button is pressed, and only deliver input to
// the focused window. Both look like "the pad is broken" at a party, so the
// README and the on-screen note say so.

const DEAD = 0.18;          // stick deadzone -- Xbox sticks rest well off-centre
const YAW_RATE = 2.8;       // radians/sec at full deflection
const PITCH_RATE = 1.8;
const PRESS = 0.5;          // trigger travel that counts as pulled...
const RELEASE = 0.3;        // ...and how far it must come back to re-arm

// Standard mapping: axes 0/1 left stick, 2/3 right stick; buttons 0 A, 5 RB,
// 7 RT. A guest handed a pad will press whatever is under their thumb, so A and
// RB fire as well as the trigger.
const FIRE_BUTTONS = [0, 5];

function shape(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  const n = (a - DEAD) / (1 - DEAD);
  return Math.sign(v) * n * n; // squared: fine aim near centre, fast turns at the edge
}

export class Pad {
  constructor({ onDown, onUp, onConnect }) {
    this.onDown = onDown;
    this.onUp = onUp;
    this.onConnect = onConnect;
    this.firing = false;
    this.activeFor = 0;       // seconds since real input, so the cursor stops fighting it
    this.index = null;

    addEventListener('gamepadconnected', (e) => {
      if (this.index == null) this.index = e.gamepad.index;
      if (this.onConnect) this.onConnect(true, e.gamepad.id);
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.index) return;
      this.index = null;
      if (this.firing) {
        this.firing = false;
        this.onUp();
      }
      if (this.onConnect) this.onConnect(false, e.gamepad.id);
    });
  }

  _pad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.index != null && pads[this.index]) return pads[this.index];
    for (const p of pads) {
      if (p && p.connected) {
        this.index = p.index;
        return p;
      }
    }
    return null;
  }

  get connected() {
    return this._pad() != null;
  }

  // True while the pad is being used, and for a moment after.
  get recent() {
    return this.activeFor > 0;
  }

  update(dt, look, clamp, pitchLimit) {
    this.activeFor = Math.max(0, this.activeFor - dt);
    const p = this._pad();
    if (!p) return;

    // Right stick looks. The left stick's horizontal also turns, because half
    // of everyone reaches for the left stick first.
    const lx = shape(p.axes[0] || 0);
    const rx = shape(p.axes[2] || 0);
    const ry = shape(p.axes[3] || 0);
    const turn = Math.abs(rx) > Math.abs(lx) ? rx : lx;

    // Yaw is a rate, not a position -- the same reason the cursor steers that
    // way: it is what makes a full turn reachable.
    if (turn) look.yaw -= turn * YAW_RATE * dt;
    if (ry) look.pitch = clamp(look.pitch - ry * PITCH_RATE * dt, -pitchLimit, pitchLimit);

    const rt = p.buttons[7] ? p.buttons[7].value : 0;
    const button = FIRE_BUTTONS.some((i) => p.buttons[i] && p.buttons[i].pressed);
    // Hysteresis on the analogue trigger, or a finger resting at the threshold
    // stutters between fired and not.
    const pulled = button || (this.firing ? rt > RELEASE : rt > PRESS);

    if (turn || ry || pulled) this.activeFor = 2;

    if (pulled && !this.firing) {
      this.firing = true;
      this.onDown();
    } else if (!pulled && this.firing) {
      this.firing = false;
      this.onUp();
    }
  }

  rumble(strong, ms) {
    const p = this._pad();
    const act = p && p.vibrationActuator;
    if (!act || !act.playEffect) return;
    try {
      act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: ms,
        strongMagnitude: Math.min(1, strong),
        weakMagnitude: Math.min(1, strong * 0.5),
      });
    } catch {
      // Unsupported in this browser; the shot still happened.
    }
  }
}
