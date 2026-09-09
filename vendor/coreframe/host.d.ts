// Types for host.js (plain JS so games consume it untyped, like Homeward's vendor/).
export interface Frame { type: number; seq: number; payload: Int32Array }
export interface RunResult { frames: Frame[]; cycles: number; idle: boolean; exited: number | null }
export interface HostOptions {
  ucSource: string;
  fwBytes: Uint8Array;
  progBytes: Uint8Array;
  argv?: string[];
  arenaBytes?: number;
  mboxBytes?: number;
  onByte?: ((b: number) => void) | null;
  slice?: number;
  /** a permuted opcode-name ROM (release builds); omit for the stock encoding */
  opnames?: string | null;
}
export interface Host {
  output(): string;
  exited(): number | null;
  send(type: number, payload?: ArrayLike<number>): void;
  run(maxCycles?: number): RunResult;
  exchange(type: number, payload?: ArrayLike<number>, maxCycles?: number): Frame[];
  shutdown(maxCycles?: number): number | null;
  cycle(): number;
}
export const BELL_REPLY: 1;
export const BELL_IDLE: 2;
export function createHost(opts: HostOptions): Host;
