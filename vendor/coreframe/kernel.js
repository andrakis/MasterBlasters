// vendored from CoreFrame/runtime/kernel.js @ b89a635 -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
// kernel.js - the kernel host: C4KE on the machine, the game's module a task
// bound to the mailbox (c4 extensions/c4ke_mbox.c), more tasks beside it.
//
//   const vm = createKernelHost({ ucSource, fwBytes, kernelBytes, files, program: 'rules.c4r' });
//   vm.exchange(type, payload) -> frames        the same shape as the bare host
//   vm.console(text)                            type at the shell (start another task, say)
//   vm.shutdown()                               frame 0 ends the bound task, \q ends the shell, the kernel halts
//
// `files` is the disk (binaries only: init, c4sh, the vfs service, vfsload,
// and the game's modules), a Map<name, Uint8Array>; runtime/kernel/disk holds
// the four the kernel needs. Time is simulated (the PIT reads the cycle
// counter), so a run is a pure function of its frames, kernel included.

import { Arena } from './sim/arena.js';
import { Devices, CYCLES_PER_MS } from './sim/devices.js';
import { Machine, setOpcodeNames } from './sim/machine.js';
import { Turbo } from './sim/turbo.js';
import { assemble } from './sim/ucode.js';
import { boot } from './sim/loader.js';
import { HostMailbox } from './sim/mbox.js';
import { makeExchange, BELL_IDLE } from './host.js';

const ucodeCache = new Map();

export function createKernelHost({ ucSource, fwBytes, kernelBytes, files, program, argv = ['c4ke32.c4r'], arenaBytes = 8 << 20, mboxBytes = 64 << 10, onByte = null, slice = 2000, opnames = null, prompt = 'c4sh>', ready = 'cf: bound', bootBudget = 60e6 }) {
  if (opnames) setOpcodeNames(opnames);
  let uc = ucodeCache.get(ucSource);
  if (!uc) { uc = assemble(ucSource); ucodeCache.set(ucSource, uc); }
  let out = '';
  let idleSeen = false;
  let mb = null;
  let machine = null;   // the clock below is read by Devices' constructor, before the machine exists
  const arena = new Arena(arenaBytes);
  const dev = new Devices(arena, {
    onByte: (b) => { out += String.fromCharCode(b); if (onByte) onByte(b); },
    onDoorbell: (v) => { if (v === BELL_IDLE && mb && mb.inboxEmpty()) idleSeen = true; },
    files,
    // simulated time: the kernel's PIT ticks on cycles, so scheduling is reproducible
    hostNow: () => (machine ? Math.floor(machine.cycle / CYCLES_PER_MS) : 0),
  });
  machine = new Machine(arena, uc, dev, { onLog: () => {} });
  const { mbox } = boot(machine, fwBytes, kernelBytes, argv, { mbox: mboxBytes });
  const turbo = new Turbo(machine);
  mb = new HostMailbox(arena, mbox);
  const gate = { idle: () => idleSeen, reset: () => { idleSeen = false; } };
  const api = makeExchange({ arena, machine, dev, turbo, mb, progImg: null, slice, gate, output: () => out,
    onShutdown: (a) => { dev.pushInput('\\q\n'); a.runUntil(() => dev.halted || a.exited() !== null, 30e6); } });

  // boot to the shell, start the program, wait until it says it is bound
  if (!api.runUntil(() => out.includes(prompt), bootBudget)) throw new Error(`coreframe: the kernel did not reach '${prompt}' in ${bootBudget} cycles:\n${out.slice(-600)}`);
  dev.pushInput(`${program}\n`);
  if (ready && !api.runUntil(() => out.includes(ready), bootBudget / 2)) throw new Error(`coreframe: ${program} did not print '${ready}':\n${out.slice(-600)}`);
  api.run(2e6);   // settle to idle

  api.console = (text) => { dev.pushInput(text); };
  return api;
}
