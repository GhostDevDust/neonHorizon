// Co-op transport.
//
// The server is a dumb relay (see serve.js): it hands out ids, says who is
// host, and forwards messages. Every rule lives here in the browser, so the
// game logic exists in one place and the server never has to be taught it.
//
// Authority: the host owns the target field -- spawning, damage, death. Clients
// mirror it and ask permission to kill things. That matters because targets now
// have hit points and scores are separate, so "who killed that" is a real
// question and needs one machine answering it.
//
// What clients do NOT wait for: their own crosshair, their own beam, their own
// camera. Those are local and instant. Only the world is authoritative, and the
// world is a few metres away and moving slowly.

const SEND_HZ = 20;

export class Net {
  constructor() {
    this.ws = null;
    this.id = 0;
    this.isHost = true;      // solo play is just being the host with no clients
    this.connected = false;
    this.peers = [];
    this.handlers = new Map();
    this._acc = 0;
    this._ka = 0;
    this._retry = 500;
    this._closed = false;
    // Only a connection that has worked before is worth retrying. A static host
    // like itch.io has no relay, so the first attempt fails and we stay solo
    // quietly instead of knocking on a closed door every five seconds.
    this._everOpened = false;
  }

  get soloOrHost() {
    return !this.connected || this.isHost;
  }

  // `prefer` asks the relay to make this peer the host if it can.
  connect({ prefer = this._prefer } = {}) {
    this._prefer = prefer;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${location.host}/coop${prefer ? '?host' : ''}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      return; // no server (opened from a file, or a static host) -- stay solo
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      this._everOpened = true;
      this._retry = 500;
    });
    ws.addEventListener('close', () => {
      // Falling back to host means a dropped connection leaves you playing
      // alone rather than staring at a frozen world.
      this.connected = false;
      this.isHost = true;
      this.id = 0;
      // Clearing this is what stops the HUD sitting in co-op mode forever,
      // showing a frozen opponent score next to yours after they have gone.
      this.peers = [];
      this._emit('peers', { peers: [] });
      // One Wi-Fi blip should not permanently end co-op. Back off and retry.
      if (!this._closed && this._everOpened) {
        this._retry = Math.min(this._retry * 2, 5000);
        setTimeout(() => this.connect(), this._retry);
      }
    });
    ws.addEventListener('error', () => { /* close follows; nothing to add */ });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'role') {
        const was = this.isHost;
        this.id = msg.id;
        this.isHost = msg.host;
        this.peers = msg.peers.filter((p) => p !== msg.id);
        this._emit('peers', msg);
        // Promotion needs its own event: the new host has to repair state that
        // only made sense as a client before it starts broadcasting.
        if (!was && this.isHost) this._emit('promote', msg);
        if (was && !this.isHost) this._emit('demote', msg);
        return;
      }
      this._emit(msg.t, msg);
    });
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }

  _emit(type, msg) {
    const fn = this.handlers.get(type);
    if (fn) fn(msg);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  // Rate-limited: the world is broadcast on a clock, not every frame. Returns
  // true when it is time to send another snapshot.
  due(dt) {
    this._acc += dt;
    if (this._acc < 1 / SEND_HZ) return false;
    this._acc = 0;
    return true;
  }

  // Driven from the render loop on purpose, never from setInterval: a frozen
  // tab must go silent. A TCP ping is answered by the browser's network process
  // on behalf of a frozen renderer, so ping/pong alone cannot tell a working
  // host from a wedged one. This can, because it stops when frames stop.
  keepAlive(dt) {
    this._ka += dt;
    if (this._ka < 1) return;
    this._ka = 0;
    this.send({ t: 'ka' });
  }
}
