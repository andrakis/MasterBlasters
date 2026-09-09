import type { Frame } from './host.js';
export interface WorkerHostOptions {
  ucSource: string;
  fwBytes: Uint8Array;
  progBytes: Uint8Array;
  argv?: string[];
  /** the Worker running runtime/worker.js, constructed by the caller */
  worker: { postMessage(m: unknown): void; terminate(): void; onmessage?: unknown; on?: unknown };
  arenaBytes?: number;
  mboxBytes?: number;
  opnames?: string | null;
  /** in-VM image attestation (default true), see HostOptions.attest */
  attest?: boolean | { bytes: Uint8Array; hash?: string | null };
}
export interface WorkerHost {
  ready: Promise<void>;
  send(type: number, payload?: ArrayLike<number>): void;
  request(type: number, payload?: ArrayLike<number>): Promise<Frame>;
  onReply(fn: (f: Frame) => void): () => void;
  drain(): Frame[];
  state(): 'booting' | 'running' | 'idle' | 'exited';
  exitStatus(): number | null;
  cycle(): number;
  output(): string;
  /** the SHA-256 (hex) the guest attested its image to, or null */
  attested(): string | null;
  terminate(): void;
}
export function createWorkerHost(opts: WorkerHostOptions): WorkerHost;
