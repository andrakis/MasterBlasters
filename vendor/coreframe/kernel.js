// vendored from CoreFrame/runtime/kernel.js @ cdb0483 -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
// kernel.js - the kernel host: C4KE on the machine, the game's module a task
// bound to the mailbox (c4 extensions/c4ke_mbox.c), more tasks beside it.
//
//   const vm = createKernelHost({ ucSource, fwBytes, kernelBytes, files, program: 'rules.c4r &' });
//   vm.exchange(type, payload) -> frames        the same shape as the bare host
//   vm.console(text)                            type at the shell (start another task, say)
//   vm.breathe(maxCycles)                       run the OS for its own sake: until the KERNEL is idle, no typed input
//                                               pending, at most N cycles (a game's per-tick budget)
//   vm.inputPending()                           bytes typed but not yet read by the shell
//   vm.shutdown()                               frame 0 ends the bound task, \q ends the shell, the kernel halts
//
// wake: 'poll' (default) leaves the interrupt line alone: the scheduler's wake scan
// checks the host mailbox for the bound task at every pass (the idle task sleeps
// 10 ms of simulated time between passes, and USLP advances that clock without
// burning cycles, so an exchange still settles in ~10k cycles). 'irq' raises
// HIRQ_MBOX on every send instead; measured 2026-09-10, an interrupt landing while
// another task (top) is being woken wedges C4KE ("switch from idle task to idle
// task", a blown task stack) -- so it is opt-in until the kernel's handler is fixed.
// TIME IS CYCLES, always. The host paces this machine in bursts -- 50k cycles here, a
// frame's worth there -- so real time and machine time are nothing like each other, and a
// kernel told that 16 ms passed while it ran 50k cycles (2.5 ms of them) schedules against
// a clock that is racing away from it: time-based waits fire every slice and the scheduler
// churns instead of running the task the host is waiting for. A `clock: 'wall'` option was
// tried on 2026-09-10 and did exactly that -- the game's rules stopped being answered a
// minute into a match, worse with another task alive. `top -d N` picks its refresh rate in
// SIMULATED ms, and the caller sizes it against the cycles it hands out (docs/messaging.md).
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
import { makeExchange, BELL_IDLE, BELL_DONE } from './host.js';

const ucodeCache = new Map();

export function createKernelHost({ ucSource, fwBytes, kernelBytes, files, program, argv = ['c4ke32.c4r'], arenaBytes = 8 << 20, mboxBytes = 64 << 10, onByte = null, slice = 2000, opnames = null, prompt = 'c4sh>', ready = 'cf: bound', bootBudget = 60e6, wake = 'poll', exchangeBudget = 20e6, stallRetries = 1, onStall = null }) {
  if (opnames) setOpcodeNames(opnames);
  let uc = ucodeCache.get(ucSource);
  if (!uc) { uc = assemble(ucSource); ucodeCache.set(ucSource, uc); }
  let out = '';
  let idleSeen = false;      // the KERNEL: nothing at all is runnable
  let doneSeen = false;      // the MODULE: it has drained the inbox and answered
  let mb = null;
  let machine = null;   // the clock below is read by Devices' constructor, before the machine exists
  const arena = new Arena(arenaBytes);
  const dev = new Devices(arena, {
    onByte: (b) => { out += String.fromCharCode(b); if (onByte) onByte(b); },
    // both bells mean "you may stop the machine", and both are only believed when the
    // inbox really is empty now (a bell rung just before the host queued a frame is stale)
    onDoorbell: (v) => {
      if (!mb || !mb.inboxEmpty()) return;
      if (v === BELL_IDLE) idleSeen = true;
      else if (v === BELL_DONE) doneSeen = true;
    },
    files,
    // simulated time: the kernel's PIT ticks on cycles (see the note above)
    hostNow: () => (machine ? Math.floor(machine.cycle / CYCLES_PER_MS) : 0),
  });
  machine = new Machine(arena, uc, dev, { onLog: () => {} });
  const { mbox } = boot(machine, fwBytes, kernelBytes, argv, { mbox: mboxBytes });
  const turbo = new Turbo(machine);
  mb = new HostMailbox(arena, mbox);
  const gate = { idle: () => idleSeen, reset: () => { idleSeen = false; doneSeen = false; } };
  const api = makeExchange({
    arena, machine, dev, turbo, mb, progImg: null, slice, gate, output: () => out, irq: wake === 'irq',
    // an exchange is done when the MODULE is done, not when the machine is: with `top` or
    // `mandel` runnable the machine never idles, and waiting for that threw away replies
    // that were already in the outbox
    settled: () => doneSeen || idleSeen,
    exchangeBudget,
    // the OS is busy (someone started a hog at the console): say so and wait again rather
    // than give up on a module that is only being scheduled slowly
    onStall: (info) => {
      const keep = info.attempt <= stallRetries;
      if (onStall) onStall({ ...info, keep });
      else console.warn(`coreframe: the kernel is busy -- frame type ${info.type} unanswered after ${info.cycles} cycles${keep ? ', waiting' : ', giving up'}`);
      return keep;
    },
    shutdownSettled: () => idleSeen,
    onShutdown: (a) => { dev.pushInput('\\q\n'); a.runUntil(() => dev.halted || a.exited() !== null, 30e6); },
  });

  // boot to the shell, start the program, wait until it says it is bound
  if (!api.runUntil(() => out.includes(prompt), bootBudget)) throw new Error(`coreframe: the kernel did not reach '${prompt}' in ${bootBudget} cycles:\n${out.slice(-600)}`);
  dev.pushInput(`${program}\n`);
  if (ready && !api.runUntil(() => out.includes(ready), bootBudget / 2)) throw new Error(`coreframe: ${program} did not print '${ready}':\n${out.slice(-600)}`);
  api.run(2e6);   // settle to idle

  api.console = (text) => { dev.pushInput(text); };
  api.inputPending = () => dev.rxFifo.length;
  api.breathe = (maxCycles = 50000) => {
    const start = machine.cycle;
    let spent = 0;
    while (spent < maxCycles && !dev.halted && api.exited() === null) {
      // the KERNEL's idle, not the module's DONE bell: breathe is the OS's own time, and
      // it stops only when nothing at all is runnable AND the shell has read what was typed
      const r = api.run(Math.min(slice, maxCycles - spent), () => gate.idle());
      spent = machine.cycle - start;
      if (r.idle && dev.rxFifo.length === 0) break;
    }
    return spent;
  };
  return api;
}

