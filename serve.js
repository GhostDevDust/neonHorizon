// Dev server. WebXR refuses to start outside a secure context, and "secure"
// means https:// or localhost -- so hitting this box from the Quest over the
// LAN needs TLS. We mint a throwaway self-signed cert on first run.

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const ROOT = __dirname;
const CERT_DIR = path.join(ROOT, '.cert');
const PORT = Number(process.env.PORT) || 8443;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function ensureCert() {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const cert = fs.readFileSync(certPath);
    if (certCovers(cert, lanAddresses())) {
      return { key: fs.readFileSync(keyPath), cert };
    }
    console.log('LAN address changed since the cert was minted -- regenerating.');
  }
  const selfsigned = require('selfsigned');
  // selfsigned v5 returns a promise
  // Apple's trust policy (macOS 10.15+/iOS 13+) is stricter than Chromium's and
  // is enforced BEFORE the "visit this website anyway" escape hatch, so a cert
  // that violates it is refused outright with no way through -- which is how the
  // Quest browser could reach this server while Safari could not. It wants a
  // serverAuth EKU, a SAN (a bare CN is ignored), RSA >= 2048, SHA-256, and a
  // lifetime under 825 days.
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'neon-horizon' }], {
    days: 397,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...lanAddresses().map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  console.log('Generated a self-signed certificate in .cert/');
  return { key: pems.private, cert: pems.cert };
}

// A cert is pinned to the IPs baked into it when it was minted. DHCP hands this
// box a new address and every client then rejects the cert as belonging to
// someone else: Chromium offers a click-through, Safari just refuses. Since the
// cert outlives the address, check it still covers us rather than serving one
// that cannot work.
function certCovers(pem, ips) {
  try {
    const san = new crypto.X509Certificate(pem).subjectAltName || '';
    const listed = new Set(
      san
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.startsWith('IP Address:'))
        .map((s) => s.slice('IP Address:'.length))
    );
    return ips.every((ip) => listed.has(ip));
  } catch {
    return false; // unreadable cert -- mint a fresh one
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function handler(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  // Contain requests to the project directory.
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ----------------------------------------------------------------- co-op
// A deliberately dumb relay: it assigns roles and forwards messages, and knows
// nothing about the game. All authority lives in the host's browser, which
// means the rules exist in exactly one place -- src/ -- and the server never
// has to be kept in sync with them.
//
// First tab in is the host and owns the world. Everyone after is a client. If
// the host leaves, the oldest remaining peer is promoted rather than dropping
// everyone, so closing a window mid-session does not end the game.
function attachCoop(server) {
  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ server, path: '/coop' });
  let nextId = 1;
  const peers = new Map(); // id -> { ws, alive, seen, away, prefer }

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  // Who should own the world. A peer that has gone quiet is skipped, and
  // ?host on the URL wins outright -- open the PC first with that flag and the
  // machine on mains power, which nobody lifts off their head, does the hosting.
  const hostId = () => {
    const live = [...peers.keys()].filter((id) => !peers.get(id).away);
    const pref = live.filter((id) => peers.get(id).prefer);
    if (pref.length) return Math.min(...pref);
    if (live.length) return Math.min(...live);
    return peers.size ? Math.min(...peers.keys()) : null;
  };

  const announce = () => {
    const h = hostId();
    for (const [id, p] of peers) {
      send(p.ws, { t: 'role', id, host: id === h, hostId: h, peers: [...peers.keys()] });
    }
  };

  // Liveness. A machine that sleeps -- a Quest set down, a laptop suspended --
  // leaves a half-open socket behind: 'close' never fires, nobody is promoted,
  // and every remaining player waits forever on a host that is gone. Ping every
  // few seconds and hang up on anything that stops answering, which puts the
  // normal disconnect path back in charge.
  //
  // Two mechanisms, because they catch different failures. A TCP ping catches a
  // genuinely dead socket. It does NOT catch a frozen tab: the browser's
  // network process answers pings on behalf of a wedged renderer, so the socket
  // looks perfectly healthy while the game behind it has stopped. For that we
  // watch whether the peer has said anything -- its keep-alive comes from the
  // render loop, so it stops exactly when the game does.
  const HEARTBEAT_MS = 2000;
  const AWAY_MS = 4000;
  const beat = setInterval(() => {
    let changed = false;
    for (const [id, p] of peers) {
      if (p.alive === false) {
        console.log(`  co-op: peer ${id} socket is dead -- dropping`);
        p.ws.terminate();   // fires 'close', which promotes the next peer
        continue;
      }
      p.alive = false;
      try {
        p.ws.ping();
      } catch {
        p.ws.terminate();
      }
      const quiet = Date.now() - p.seen > AWAY_MS;
      if (quiet !== p.away) {
        p.away = quiet;
        changed = true;
        console.log(`  co-op: peer ${id} ${quiet ? 'went quiet' : 'is back'}`);
      }
    }
    if (changed) announce();   // re-elect around whoever stopped talking
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(beat));

  wss.on('connection', (ws, req) => {
    const id = nextId++;
    const p = {
      ws,
      alive: true,
      seen: Date.now(),
      away: false,
      prefer: /[?&]host/.test(req.url || ''),
    };
    ws.on('pong', () => { p.alive = true; });
    peers.set(id, p);
    console.log(`  co-op: peer ${id} joined (${peers.size} connected)` +
                `  url=${req.url} ua=${(req.headers['user-agent'] || '').slice(-28)}`);
    announce();

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return; // a malformed frame is not worth dropping the peer over
      }
      // Anything at all counts as proof of life.
      p.seen = Date.now();
      if (p.away) {
        p.away = false;
        announce();
      }
      if (msg.t === 'ka') return;   // keep-alives are consumed, never forwarded

      msg.from = id;
      const raw = JSON.stringify(msg);
      // `to` addresses one peer; anything else goes to everyone but the sender.
      if (msg.to != null) {
        const target = peers.get(msg.to);
        if (target && target.ws.readyState === target.ws.OPEN) target.ws.send(raw);
        return;
      }
      for (const [pid, peer] of peers) {
        if (pid !== id && peer.ws.readyState === peer.ws.OPEN) peer.ws.send(raw);
      }
    });

    ws.on('close', () => {
      peers.delete(id);
      console.log(`  co-op: peer ${id} left (${peers.size} connected)`);
      announce(); // promotes the next-oldest peer if the host was the one to go
    });
  });
}

const useHttp = process.argv.includes('--http');

// ensureCert() is async (selfsigned v5 returns a promise), so the options must
// be awaited before they reach createServer -- handing it a pending promise
// yields a server with no key and every TLS handshake fails.
(async () => {
  const server = useHttp
    ? http.createServer(handler)
    : https.createServer(await ensureCert(), handler);

  attachCoop(server);

  server.on('tlsClientError', (err) => {
    console.error('TLS handshake failed:', err.message);
  });

  server.listen(PORT, '0.0.0.0', () => {
    const scheme = useHttp ? 'http' : 'https';
    console.log('\n  NEON HORIZON dev server\n');
    console.log(`  desktop:  ${scheme}://localhost:${PORT}/`);
    for (const ip of lanAddresses()) {
      console.log(`  headset:  ${scheme}://${ip}:${PORT}/`);
    }
    console.log('  co-op:    same URL -- first tab hosts, the rest join');
    console.log('\n  On the Quest you will get a certificate warning the first');
    console.log('  time -- tap Advanced, then Proceed. WebXR still works.\n');
  });
})();
