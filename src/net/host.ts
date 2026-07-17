// The host session: owns the room, offers a peer connection to every joiner,
// assigns player slots, fans snapshots out on the fast channels, and measures
// per-peer RTT to feed the sim's hitscan lag compensation.
//
// The host's own game keeps running off the local worker exactly as in
// single player — this module only adds the wire.

import { CFG } from '../config.ts';
import {
  decodeCmd, encodeSnapshot,
  type MatchSettings, type OrdMsg, type SnapState, type UserCmd,
} from '../protocol.ts';
import type { SimEvent } from '../sim/types.ts';
import { makeFastChannel, makeOrdChannel, makePeer, openSignaling, sendSignal, type SignalData } from './rtc.ts';

interface Peer {
  sigId: number; // signaling-level id
  playerId: number; // sim slot; -1 until hello
  name: string;
  pc: RTCPeerConnection;
  ord: RTCDataChannel;
  fast: RTCDataChannel;
  rtt: number; // ms, smoothed
  pingAt: number;
}

export interface HostCallbacks {
  onRoomCode: (code: string) => void;
  onRosterChange: (names: string[]) => void;
  onPeerCmd: (playerId: number, cmd: UserCmd) => void;
  onPeerLag: (playerId: number, lagTicks: number) => void;
  onError: (message: string) => void;
}

export class HostSession {
  private ws: WebSocket;
  private peers = new Map<number, Peer>(); // by signaling id
  private cb: HostCallbacks;
  private pingTimer: ReturnType<typeof setInterval>;
  hostName: string;
  roomCode = '';
  matchSettings: MatchSettings | null = null;
  matchNames: string[] = [];
  bytesOut = 0; // rolling counter for the debug HUD

  constructor(hostName: string, cb: HostCallbacks) {
    this.hostName = hostName;
    this.cb = cb;
    this.ws = openSignaling(
      (m) => this.onSignal(m),
      () => {
        // signaling loss only prevents NEW joins; live matches keep playing
      },
    );
    this.ws.onopen = () => sendSignal(this.ws, { t: 'host' });
    this.pingTimer = setInterval(() => this.pingAll(), 2000);
  }

  roster(): string[] {
    const names = [this.hostName];
    for (const p of this.peers.values()) {
      if (p.playerId > 0) names[p.playerId] = p.name;
    }
    return names;
  }

  private onSignal(m: import('../protocol.ts').SignalMsg): void {
    if (m.t === 'hosted') {
      this.roomCode = m.code;
      this.cb.onRoomCode(m.code);
    } else if (m.t === 'peer') {
      this.addPeer(m.peerId);
    } else if (m.t === 'signal' && m.peerId !== undefined) {
      const peer = this.peers.get(m.peerId);
      if (!peer) return;
      const data = m.data as SignalData;
      if (data.sdp) void peer.pc.setRemoteDescription(data.sdp);
      if (data.ice) void peer.pc.addIceCandidate(data.ice);
    } else if (m.t === 'peer-left') {
      this.dropPeer(m.peerId);
    } else if (m.t === 'error') {
      this.cb.onError(m.message);
    }
  }

  private addPeer(sigId: number): void {
    const pc = makePeer((ice) => sendSignal(this.ws, { t: 'signal', peerId: sigId, data: { ice } }));
    const ord = makeOrdChannel(pc);
    const fast = makeFastChannel(pc);
    const peer: Peer = { sigId, playerId: -1, name: '', pc, ord, fast, rtt: 50, pingAt: 0 };
    this.peers.set(sigId, peer);

    ord.onmessage = (e) => this.onOrd(peer, JSON.parse(String(e.data)) as OrdMsg);
    fast.onmessage = (e) => {
      if (peer.playerId > 0 && e.data instanceof ArrayBuffer && e.data.byteLength === 10) {
        this.cb.onPeerCmd(peer.playerId, decodeCmd(e.data));
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.dropPeer(sigId);
    };

    void pc.createOffer().then(async (offer) => {
      await pc.setLocalDescription(offer);
      sendSignal(this.ws, { t: 'signal', peerId: sigId, data: { sdp: offer } });
    });
  }

  private onOrd(peer: Peer, msg: OrdMsg): void {
    if (msg.t === 'hello') {
      // assign the lowest free sim slot >= 1
      const taken = new Set([0, ...[...this.peers.values()].map((p) => p.playerId)]);
      let slot = 1;
      while (taken.has(slot)) slot++;
      if (slot >= CFG.MAX_PLAYERS) {
        this.sendOrd(peer, { t: 'bye' });
        return;
      }
      peer.playerId = slot;
      peer.name = msg.name.slice(0, 16) || `Peer${slot}`;
      this.sendOrd(peer, { t: 'welcome', playerId: slot, roster: this.roster() });
      this.broadcastRoster();
      // a mid-match joiner gets the match config immediately
      if (this.matchSettings) {
        this.sendOrd(peer, {
          t: 'start', settings: this.matchSettings, names: this.matchNames, yourId: slot,
        });
      }
    } else if (msg.t === 'pong') {
      const rtt = performance.now() - msg.at;
      peer.rtt = peer.rtt * 0.7 + rtt * 0.3;
      const lagTicks = Math.round(((peer.rtt / 2 + CFG.INTERP_MS) / 1000) * CFG.TICK_HZ);
      if (peer.playerId > 0) this.cb.onPeerLag(peer.playerId, lagTicks);
    }
  }

  private sendOrd(peer: Peer, msg: OrdMsg): void {
    if (peer.ord.readyState === 'open') peer.ord.send(JSON.stringify(msg));
  }

  private broadcastRoster(): void {
    const roster = this.roster();
    for (const p of this.peers.values()) {
      if (p.playerId > 0) this.sendOrd(p, { t: 'roster', roster });
    }
    this.cb.onRosterChange(roster);
  }

  private pingAll(): void {
    const at = performance.now();
    for (const p of this.peers.values()) {
      if (p.playerId > 0) this.sendOrd(p, { t: 'ping', at });
    }
  }

  private dropPeer(sigId: number): void {
    const peer = this.peers.get(sigId);
    if (!peer) return;
    this.peers.delete(sigId);
    try {
      peer.pc.close();
    } catch {
      // already closed
    }
    this.broadcastRoster();
  }

  /** Build the match roster (host + peers + bots) and tell every peer to start.
   *  Returns the settings the host's own worker should be configured with. */
  startMatch(base: MatchSettings): MatchSettings {
    const humans = this.roster();
    const roster = [
      ...humans.map((name) => ({ name, bot: false })),
      ...Array.from({ length: Math.min(base.botCount, CFG.MAX_PLAYERS - humans.length) }, () => ({
        name: '', bot: true,
      })),
    ];
    const settings: MatchSettings = { ...base, roster };
    this.matchSettings = settings;
    this.matchNames = humans;
    for (const p of this.peers.values()) {
      if (p.playerId > 0) {
        this.sendOrd(p, { t: 'start', settings, names: humans, yourId: p.playerId });
      }
    }
    return settings;
  }

  /** Encode once, fan out on every open fast channel. Called at SNAP_EVERY ticks. */
  broadcastSnapshot(snap: SnapState): void {
    if (this.peers.size === 0) return;
    const buf = encodeSnapshot(snap);
    for (const p of this.peers.values()) {
      if (p.playerId > 0 && p.fast.readyState === 'open') {
        p.fast.send(buf);
        this.bytesOut += buf.byteLength;
      }
    }
  }

  broadcastEvents(tick: number, events: SimEvent[]): void {
    for (const p of this.peers.values()) {
      if (p.playerId > 0) this.sendOrd(p, { t: 'events', tick, events });
    }
  }

  /** Full in-match name list (humans + world-generated bot names). */
  broadcastNames(names: string[]): void {
    this.matchNames = names;
    for (const p of this.peers.values()) {
      if (p.playerId > 0) this.sendOrd(p, { t: 'names', names });
    }
  }

  close(): void {
    clearInterval(this.pingTimer);
    for (const p of this.peers.values()) {
      this.sendOrd(p, { t: 'bye' });
      try {
        p.pc.close();
      } catch {
        // fine
      }
    }
    this.peers.clear();
    this.ws.close();
  }
}
