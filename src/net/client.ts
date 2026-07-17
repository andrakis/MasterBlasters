// The client session: joins a room by code, answers the host's offer, then lives
// on two channels — usercmds up / snapshots down on 'fast', everything reliable
// on 'ord'. Decoded snapshots and events flow to simClient, which builds frames
// for the same renderer the local game uses.

import {
  decodeSnapshot, encodeCmd,
  type MatchSettings, type OrdMsg, type SnapState, type UserCmd,
} from '../protocol.ts';
import type { SimEvent } from '../sim/types.ts';
import { makePeer, openSignaling, sendSignal, type SignalData } from './rtc.ts';

export interface ClientCallbacks {
  onWelcome: (playerId: number, roster: string[]) => void;
  onRoster: (roster: string[]) => void;
  onStart: (settings: MatchSettings, names: string[], yourId: number) => void;
  onNames: (names: string[]) => void;
  onSnapshot: (snap: SnapState) => void;
  onEvents: (events: SimEvent[]) => void;
  onDisconnect: (reason: string) => void;
}

export class ClientSession {
  private ws: WebSocket;
  private pc: RTCPeerConnection | null = null;
  private ord: RTCDataChannel | null = null;
  private fast: RTCDataChannel | null = null;
  private cb: ClientCallbacks;
  private name: string;
  playerId = -1;
  bytesIn = 0;

  constructor(code: string, name: string, cb: ClientCallbacks) {
    this.cb = cb;
    this.name = name;
    this.ws = openSignaling(
      (m) => this.onSignal(m),
      () => {
        // signaling loss after connect is fine; the DataChannels carry the game
      },
    );
    this.ws.onopen = () => sendSignal(this.ws, { t: 'join', code });
  }

  private onSignal(m: import('../protocol.ts').SignalMsg): void {
    if (m.t === 'error') {
      this.cb.onDisconnect(m.message);
    } else if (m.t === 'host-left') {
      this.cb.onDisconnect('host left');
    } else if (m.t === 'signal') {
      const data = m.data as SignalData;
      if (data.sdp) void this.onOffer(data.sdp);
      else if (data.ice && this.pc) void this.pc.addIceCandidate(data.ice);
    }
  }

  private async onOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = makePeer((ice) => sendSignal(this.ws, { t: 'signal', data: { ice } }));
    this.pc = pc;
    pc.ondatachannel = (e) => {
      const ch = e.channel;
      if (ch.label === 'fast') {
        ch.binaryType = 'arraybuffer';
        this.fast = ch;
        ch.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            this.bytesIn += ev.data.byteLength;
            this.cb.onSnapshot(decodeSnapshot(ev.data));
          }
        };
      } else if (ch.label === 'ord') {
        this.ord = ch;
        ch.onopen = () => this.sendOrd({ t: 'hello', name: this.name });
        ch.onmessage = (ev) => this.onOrd(JSON.parse(String(ev.data)) as OrdMsg);
        ch.onclose = () => this.cb.onDisconnect('connection closed');
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.cb.onDisconnect('connection failed');
    };
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(this.ws, { t: 'signal', data: { sdp: answer } });
  }

  private onOrd(msg: OrdMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.cb.onWelcome(msg.playerId, msg.roster);
        break;
      case 'roster':
        this.cb.onRoster(msg.roster);
        break;
      case 'start':
        this.cb.onStart(msg.settings, msg.names, msg.yourId);
        break;
      case 'names':
        this.cb.onNames(msg.names);
        break;
      case 'events':
        this.cb.onEvents(msg.events);
        break;
      case 'ping':
        this.sendOrd({ t: 'pong', at: msg.at });
        break;
      case 'bye':
        this.cb.onDisconnect('room full or closed');
        break;
      default:
        break;
    }
  }

  private sendOrd(msg: OrdMsg): void {
    if (this.ord?.readyState === 'open') this.ord.send(JSON.stringify(msg));
  }

  sendCmd(cmd: UserCmd): void {
    if (this.fast?.readyState === 'open') this.fast.send(encodeCmd(cmd));
  }

  close(): void {
    try {
      this.pc?.close();
    } catch {
      // fine
    }
    this.ws.close();
  }
}
