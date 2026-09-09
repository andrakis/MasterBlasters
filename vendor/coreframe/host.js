// vendored from CoreFrame/runtime/host.js @ 59bbaa8 -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
// host.js - the in-thread host: one persistent machine, the mailbox, and
// "run until the guest says idle". Plain ESM; works in a page, a worker,
// and node alike (node/host.js adds file loading, worker.js the thread).
//
//   const host = createHost({ ucSource, fwBytes, progBytes, argv, arenaBytes, mboxBytes, onByte });
//   host.send(type, payloadInt32);           queue a frame for the guest
//   const { frames, cycles, idle } = host.run(maxCycles);   run until the idle bell, drain replies
//   host.exchange(type, payload) -> frames    send + run, the common RPC shape
//   host.shutdown()                           frame type 0, run to exit, status
//
// The idle bell is verified against the inbox (see onDoorbell): a bell rung
// between the guest's last poll and the host's send is stale and ignored.
//
// The machine is never rebooted between calls: a module keeps its state in
// guest globals. Determinism: a given sequence of frames produces the same
// replies and the same cycle count on every host (the sim has no wall
// clock). The host stops the machine when the guest rings IDLE, so an idle
// guest costs nothing between calls.

import { Arena, CONS_RET } from './sim/arena.js';
import { Devices } from './sim/devices.js';
import { Machine, R, setOpcodeNames } from './sim/machine.js';
import { Turbo } from './sim/turbo.js';
import { assemble } from './sim/ucode.js';
import { boot, runToExit } from './sim/loader.js';
import { HostMailbox } from './sim/mbox.js';

export const BELL_REPLY = 1, BELL_IDLE = 2;

let ucodeCache = new Map();

// opnames: a permuted opcode-name ROM (tools/permute-release.sh) -- the
// machine's encoding, shared by every host in this JS realm; the firmware
// and the module must have been permuted with the same seed. Omit for stock.
export function createHost({ ucSource, fwBytes, progBytes, argv = ['module.c4r'], arenaBytes = 4 << 20, mboxBytes = 64 << 10, onByte = null, slice = 256, opnames = null }) {
  if (opnames) setOpcodeNames(opnames);
  let uc = ucodeCache.get(ucSource);
  if (!uc) { uc = assemble(ucSource); ucodeCache.set(ucSource, uc); }
  let out = '';
  let idleSeen = false, replySeen = false;
  const arena = new Arena(arenaBytes);
  const dev = new Devices(arena, {
    onByte: onByte ?? ((b) => { out += String.fromCharCode(b); }),
    // An IDLE bell is only believed when the inbox really is empty NOW: the
    // guest may have polled just before the host queued a frame, in which
    // case its bell is stale and the frame is still waiting.
    onDoorbell: (v) => { if (v === BELL_IDLE) { if (mb.inboxEmpty()) idleSeen = true; } else if (v === BELL_REPLY) replySeen = true; },
  });
  const machine = new Machine(arena, uc, dev, { onLog: () => {} });
  const { progImg, mbox } = boot(machine, fwBytes, progBytes, argv, { mbox: mboxBytes });
  if (!mbox) throw new Error('coreframe: no mailbox region');
  const turbo = new Turbo(machine);
  const mb = new HostMailbox(arena, mbox);
  let exited = null;

  function step(maxCycles) {
    const start = machine.cycle;
    idleSeen = false; replySeen = false;
    while (machine.cycle - start < maxCycles && !dev.halted && exited === null) {
      turbo.run(Math.min(slice, maxCycles - (machine.cycle - start)), CONS_RET);
      if (machine.regs[R.PC] === CONS_RET) { exited = runToExit(machine, progImg, 1e6, turbo); break; }
      if (idleSeen) break;
    }
    if (dev.halted && exited === null) exited = dev.status;
    return machine.cycle - start;
  }

  return {
    arena, machine, dev, mailbox: mb,
    /** guest text output so far (printf) */
    output: () => out,
    /** the guest exited (status) or halted; null while resident */
    exited: () => exited,
    send(type, payload = []) {
      if (!mb.send(type, payload)) throw new Error(`coreframe: guest inbox full (type ${type})`);
    },
    run(maxCycles = 5e6) {
      const cycles = step(maxCycles);
      return { frames: mb.drain(), cycles, idle: idleSeen, exited };
    },
    exchange(type, payload = [], maxCycles = 5e6) {
      this.send(type, payload);
      const r = this.run(maxCycles);
      if (!r.idle && r.exited === null) throw new Error(`coreframe: guest did not go idle within ${maxCycles} cycles (type ${type})`);
      return r.frames;
    },
    /** frame type 0 asks the resident loop to return from main */
    shutdown(maxCycles = 5e6) {
      if (exited !== null) return exited;
      mb.send(0, []);
      step(maxCycles);
      return exited;
    },
    cycle: () => machine.cycle,
  };
}
