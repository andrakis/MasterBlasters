import type { Host } from './host.js';
export interface KernelHostOptions {
  ucSource: string;
  fwBytes: Uint8Array;
  /** runtime/kernel/c4ke32.c4r */
  kernelBytes: Uint8Array;
  /** the disk: runtime/kernel/disk/* plus the game's modules, binaries only */
  files: Map<string, Uint8Array>;
  /** the module to start at the shell; it must print `ready` (cf_kmain.c prints "cf: bound") */
  program: string;
  argv?: string[];
  arenaBytes?: number;
  mboxBytes?: number;
  onByte?: ((b: number) => void) | null;
  slice?: number;
  opnames?: string | null;
  prompt?: string;
  ready?: string | null;
  bootBudget?: number;
  /** CYCLES_PER_MS of simulated time per 20000 cycles: the kernel's clock is the cycle counter, always (see kernel.js) */
  /** 'poll' (default): the scheduler's scan picks frames up; 'irq': HIRQ_MBOX on every send (wedges C4KE beside live tasks, opt-in) */
  wake?: 'irq' | 'poll';
  /** cycles an exchange waits for the module before it counts as a stall (default 20M; a quiet one costs ~10k) */
  exchangeBudget?: number;
  /** how many further budgets a stalled exchange waits out while the OS is busy (default 1) */
  stallRetries?: number;
  /** told about a stalled exchange: { type, attempt, cycles, frames, keep } */
  onStall?: ((info: { type: number; attempt: number; cycles: number; frames: number; keep: boolean }) => void) | null;
}
export interface KernelHost extends Host {
  /** type at the kernel's shell (start another task, say) */
  console(text: string): void;
  runUntil(pred: () => boolean, maxCycles?: number): boolean;
  /** run the OS for its own sake: until idle with no typed input pending, at most maxCycles; returns cycles spent */
  breathe(maxCycles?: number): number;
  /** bytes typed but not yet read by the shell */
  inputPending(): number;
}
export function createKernelHost(opts: KernelHostOptions): KernelHost;
