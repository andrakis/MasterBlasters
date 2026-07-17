// WebRTC signaling: rooms with 4-letter codes, relaying SDP/ICE between the host
// and its peers. Attached to BOTH the Vite dev server (vite.config.js plugin) and
// the Express prod server (server/index.js) at the same-origin path /signal, so
// the client never needs a second endpoint. Message shapes: protocol.ts SignalMsg.

import { WebSocketServer } from 'ws';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L lookalikes

export function attachSignaling(httpServer, path = '/signal') {
  const wss = new WebSocketServer({ noServer: true });
  // code -> { host: ws, peers: Map<peerId, ws>, nextPeerId }
  const rooms = new Map();

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== path) return; // Vite HMR and friends handle their own upgrades
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  const send = (ws, msg) => {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  wss.on('connection', (ws) => {
    // per-connection role, set by the first host/join message
    let room = null;
    let code = null;
    let peerId = 0; // 0 = the host

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.t === 'host') {
        do {
          code = Array.from({ length: 4 }, () => CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0]).join('');
        } while (rooms.has(code));
        room = { host: ws, peers: new Map(), nextPeerId: 1 };
        rooms.set(code, room);
        send(ws, { t: 'hosted', code });
      } else if (msg.t === 'join') {
        const target = rooms.get(String(msg.code || '').toUpperCase());
        if (!target) {
          send(ws, { t: 'error', message: 'no such room' });
          return;
        }
        room = target;
        code = String(msg.code).toUpperCase();
        peerId = room.nextPeerId++;
        room.peers.set(peerId, ws);
        send(ws, { t: 'joined' });
        send(room.host, { t: 'peer', peerId });
      } else if (msg.t === 'signal' && room) {
        if (peerId === 0) {
          // host -> a specific peer
          send(room.peers.get(msg.peerId), { t: 'signal', data: msg.data });
        } else {
          // peer -> host, stamped with the sender
          send(room.host, { t: 'signal', peerId, data: msg.data });
        }
      }
    });

    ws.on('close', () => {
      if (!room) return;
      if (peerId === 0) {
        for (const peer of room.peers.values()) send(peer, { t: 'host-left' });
        rooms.delete(code);
      } else {
        room.peers.delete(peerId);
        send(room.host, { t: 'peer-left', peerId });
      }
    });
  });

  return wss;
}
