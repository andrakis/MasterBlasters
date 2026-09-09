// vendored from CoreFrame/runtime/worker.js @ b0a5860 -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
// worker.js - the machine on its own thread, its RAM a SharedArrayBuffer.
//
// The page (client.js) owns the other end of the mailbox rings directly in
// the shared arena; this thread runs the machine until the guest rings IDLE,
// then sleeps on a control word until the page kicks it. No idle cost, no
// copies: a frame written by the page is in guest RAM already.
//
// Control words (Int32Array over a small separate SharedArrayBuffer):
//   CTRL_KICK   the page increments and notifies: frames are queued
//   CTRL_SEQ    this thread increments (Atomics.store, a release) after every
//               slice: the page reads it (Atomics.load, an acquire) before it
//               touches the rings, which orders the guest's plain stores
//   CTRL_STATE  0 booting, 1 running, 2 idle (waiting for a kick), 3 exited
//   CTRL_EXIT   the guest's exit status once CTRL_STATE is 3
//   CTRL_CYCLES_LO/HI  the machine's cycle counter after the last slice
//
// Runs under a browser Worker (self) and node's worker_threads alike.

import { Arena, CONS_RET } from './sim/arena.js';
import { Devices } from './sim/devices.js';
import { Machine, R, setOpcodeNames } from './sim/machine.js';
import { Turbo } from './sim/turbo.js';
import { assemble } from './sim/ucode.js';
import { runToExit } from './sim/loader.js';
import { bootModule } from './host.js';
import { HostMailbox } from './sim/mbox.js';

import { CTRL_KICK, CTRL_SEQ, CTRL_STATE, CTRL_EXIT, CTRL_CYCLES_LO, CTRL_CYCLES_HI, STATE_RUNNING, STATE_IDLE, STATE_EXITED } from './ctrl.js';
const BELL_IDLE = 2;

// Bind only when this really is a worker (a browser Worker, or a node worker
// thread); importing this module on a main thread must be harmless.
let port = null;
async function bind() {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
    port = { post: (m) => self.postMessage(m), on: (fn) => { self.onmessage = (e) => fn(e.data); } };
    return true;
  }
  try {
    const { parentPort, isMainThread } = await import('node:worker_threads');
    if (isMainThread || !parentPort) return false;
    port = { post: (m) => parentPort.postMessage(m), on: (fn) => parentPort.on('message', fn) };
    return true;
  } catch { return false; }
}

if (await bind()) {
  port.on((m) => {
    if (m.type !== 'boot') return;
    try { run(m); } catch (e) { port.post({ type: 'error', message: e.message, stack: e.stack }); }
  });
}

function run({ ucSource, fwBytes, progBytes, argv = ['module.c4r'], sab, ctrlSab, mboxBytes = 64 << 10, opnames = null, slice = 512, attest = true }) {
  if (opnames) setOpcodeNames(opnames);
  const ctrl = new Int32Array(ctrlSab);
  const arena = new Arena(sab);
  let out = '', log = '';
  let idleSeen = false;
  let mb = null;
  const dev = new Devices(arena, {
    onByte: (b) => { out += String.fromCharCode(b); log += String.fromCharCode(b); if (b === 10) { port.post({ type: 'output', text: out }); out = ''; } },
    onDoorbell: (v) => { if (v === BELL_IDLE && mb && mb.inboxEmpty()) idleSeen = true; },
  });
  const machine = new Machine(arena, uc(ucSource), dev, { onLog: () => {} });
  const { progImg, mbox, attested } = bootModule(machine, fwBytes, progBytes, argv, { mbox: mboxBytes, attest });
  mb = new HostMailbox(arena, mbox);
  const turbo = new Turbo(machine);
  if (attested) {
    // settle before 'ready': the guest hashes its image first, and a refusal
    // (status 3) must reach the page as an error, not as a machine that never answers
    let done = null;
    while (!idleSeen && !dev.halted && done === null) {
      turbo.run(slice, CONS_RET);
      if (machine.regs[R.PC] === CONS_RET) done = runToExit(machine, progImg, 1e6, turbo);
    }
    if (dev.halted && done === null) done = dev.status;
    if (done !== null) { port.post({ type: 'error', message: `coreframe: the guest refused to run (status ${done}): ${log.trim()}` }); return; }
  }
  port.post({ type: 'ready', mbox, attested });
  Atomics.store(ctrl, CTRL_STATE, STATE_RUNNING);

  let seenKick = Atomics.load(ctrl, CTRL_KICK);
  for (;;) {
    // run until the guest goes idle (verified against the inbox) or exits
    idleSeen = false;
    let exited = null;
    while (!idleSeen && !dev.halted && exited === null) {
      turbo.run(slice, CONS_RET);
      if (machine.regs[R.PC] === CONS_RET) exited = runToExit(machine, progImg, 1e6, turbo);
      Atomics.store(ctrl, CTRL_CYCLES_LO, machine.cycle | 0);
      Atomics.store(ctrl, CTRL_CYCLES_HI, (machine.cycle / 0x100000000) | 0);
      Atomics.add(ctrl, CTRL_SEQ, 1);            // release: the page may read the rings now
      if (mb.pending()) port.post({ type: 'replies' });
    }
    if (dev.halted && exited === null) exited = dev.status;
    if (exited !== null) {
      Atomics.store(ctrl, CTRL_EXIT, exited | 0);
      Atomics.store(ctrl, CTRL_STATE, STATE_EXITED);
      Atomics.add(ctrl, CTRL_SEQ, 1);
      port.post({ type: 'exited', status: exited });
      return;
    }
    // idle: sleep until the page kicks (a frame queued after our last poll counts too)
    Atomics.store(ctrl, CTRL_STATE, STATE_IDLE);
    while (Atomics.load(ctrl, CTRL_KICK) === seenKick && mb.inboxEmpty()) Atomics.wait(ctrl, CTRL_KICK, seenKick);
    seenKick = Atomics.load(ctrl, CTRL_KICK);
    Atomics.store(ctrl, CTRL_STATE, STATE_RUNNING);
  }
}

const ucCache = new Map();
function uc(src) { let u = ucCache.get(src); if (!u) { u = assemble(src); ucCache.set(src, u); } return u; }
