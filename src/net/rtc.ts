// Shared WebRTC plumbing: peer construction and the signaling WebSocket. The
// host is always the offerer; every pair gets TWO DataChannels — 'ord'
// (reliable-ordered: handshake, events, pings) and 'fast' (unordered, no
// retransmits: usercmds up, snapshots down — the UDP of the browser).

import type { SignalMsg } from '../protocol.ts';

export interface SignalData {
  sdp?: RTCSessionDescriptionInit;
  ice?: RTCIceCandidateInit;
}

export function makePeer(onIce: (ice: RTCIceCandidateInit) => void): RTCPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  pc.onicecandidate = (e) => {
    if (e.candidate) onIce(e.candidate.toJSON());
  };
  return pc;
}

export function makeFastChannel(pc: RTCPeerConnection): RTCDataChannel {
  const ch = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
  ch.binaryType = 'arraybuffer';
  return ch;
}

export function makeOrdChannel(pc: RTCPeerConnection): RTCDataChannel {
  return pc.createDataChannel('ord'); // reliable ordered is the default
}

/** Same-origin signaling socket (server/signaling.js handles /signal in dev+prod). */
export function openSignaling(onMsg: (m: SignalMsg) => void, onClose: () => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/signal`);
  ws.onmessage = (e) => {
    try {
      onMsg(JSON.parse(String(e.data)) as SignalMsg);
    } catch {
      // malformed signaling is dropped
    }
  };
  ws.onclose = onClose;
  return ws;
}

export function sendSignal(ws: WebSocket, msg: SignalMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
