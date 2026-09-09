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
}
export interface KernelHost extends Host {
  /** type at the kernel's shell (start another task, say) */
  console(text: string): void;
  runUntil(pred: () => boolean, maxCycles?: number): boolean;
}
export function createKernelHost(opts: KernelHostOptions): KernelHost;
