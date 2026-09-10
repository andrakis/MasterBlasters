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
  /** 'cycles' (default): the PIT follows the cycle counter, runs are reproducible; 'wall': real time (an OS beside a game) */
  clock?: 'cycles' | 'wall';
  /** 'poll' (default): the scheduler's scan picks frames up; 'irq': HIRQ_MBOX on every send (wedges C4KE beside live tasks, opt-in) */
  wake?: 'irq' | 'poll';
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
