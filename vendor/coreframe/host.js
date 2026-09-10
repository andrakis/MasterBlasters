// vendored from CoreFrame/runtime/host.js @ 45eef6a -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
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
import { sha256, hex } from './sha256.js';

export const BELL_REPLY = 1, BELL_IDLE = 2;

let ucodeCache = new Map();

// opnames: a permuted opcode-name ROM (tools/permute-release.sh) -- the
// machine's encoding, shared by every host in this JS realm; the firmware
// and the module must have been permuted with the same seed. Omit for stock.
//
// attest (default true): the module's image bytes are parked in a reserve
// below the mailbox and the guest is booted with their address, length and
// SHA-256 (argv); modules/cf_main.c recomputes the hash inside the VM and
// refuses to run on a mismatch, which createHost turns into a throw. The
// host runs the guest to its first idle before returning, so a refusal is
// an error at construction, not a silent dead machine. attest may also be
// { bytes, hash } to attest other bytes (the runtime's own hash test).
export function createHost({ ucSource, fwBytes, progBytes, argv = ['module.c4r'], arenaBytes = 4 << 20, mboxBytes = 64 << 10, onByte = null, slice = 256, opnames = null, attest = true }) {
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
    onDoorbell: (v) => { if (v === BELL_IDLE) { if (mb && mb.inboxEmpty()) idleSeen = true; } else if (v === BELL_REPLY) replySeen = true; },
  });
  const machine = new Machine(arena, uc, dev, { onLog: () => {} });
  const { progImg, mbox, attested } = bootModule(machine, fwBytes, progBytes, argv, { mbox: mboxBytes, attest });
  if (!mbox) throw new Error('coreframe: no mailbox region');
  const turbo = new Turbo(machine);
  const mb = new HostMailbox(arena, mbox);
  const gate = { idle: () => idleSeen, reset: () => { idleSeen = false; replySeen = false; } };
  const api = makeExchange({ arena, machine, dev, turbo, mb, progImg, slice, gate, output: () => out });
  if (attested) {
    const r = api.run(200e6);
    if (r.exited !== null) throw new Error(`coreframe: the guest refused to run (status ${r.exited}): ${out.trim()}`);
    if (!r.idle) throw new Error('coreframe: the guest did not settle after boot');
  }
  return api;
}

/**
 * boot() plus attestation: park the bytes to attest in the loader's reserve
 * and hand the guest their address, length and expected SHA-256 through
 * argv (argv[0] kept, then 'attest', addr, len, hex). Returns boot()'s result
 * plus `attested` (the expected hex, or null when attestation is off).
 * attest: true (the image itself), { bytes, hash? }, or false.
 */
export function bootModule(machine, fwBytes, progBytes, argv, { mbox, attest = true }) {
  const arena = machine.arena;
  const att = attest && progBytes ? (attest === true ? { bytes: progBytes, hash: null } : attest) : null;
  const r = boot(machine, fwBytes, progBytes, argv, { mbox, reserve: att ? Math.max(1, att.bytes.length) : 0 });
  let attested = null;
  if (att) {
    arena.u8.set(att.bytes, r.reserve.base);
    attested = att.hash ?? hex(sha256(att.bytes));
    // argv lives in the 4 KB reserve above the stack: rewrite it with the attest words
    const strings = [argv[0], 'attest', String(r.reserve.base), String(att.bytes.length), attested];
    const enc = new TextEncoder();
    let p = arena.stackTop; const addrs = [];
    for (const str of strings) { const b = enc.encode(str); arena.u8.set(b, p); arena.u8[p + b.length] = 0; addrs.push(p); p += b.length + 1; }
    p = (p + 3) & ~3;
    const base = p;
    for (const a of addrs) { arena.write32(p, a); p += 4; }
    const sp = machine.regs[R.SP];
    arena.write32(sp + 8, strings.length);   // argc  (boot pushed argc, argv, CONS_RET)
    arena.write32(sp + 4, base);             // argv
  }
  return { ...r, attested };
}

/**
 * The exchange loop shared by the bare host and the kernel host: run in slices
 * until the guest's (verified) idle bell, drain the replies.
 * ctx: { arena, machine, dev, turbo, mb, progImg | null, slice, gate: { idle(), reset() }, output(), onShutdown? }
 */
export function makeExchange(ctx) {
  const { arena, machine, dev, turbo, mb, progImg, slice, gate } = ctx;
  let exited = null;

  function step(maxCycles) {
    const start = machine.cycle;
    gate.reset();
    while (machine.cycle - start < maxCycles && !dev.halted && exited === null) {
      turbo.run(Math.min(slice, maxCycles - (machine.cycle - start)), CONS_RET);
      // main returned: a bare module's (run its destructors) or the kernel's own
      // (it shut down) -- either way the machine is done, and turbo would
      // otherwise return at once without spending a cycle, forever
      if (machine.regs[R.PC] === CONS_RET) { exited = progImg ? runToExit(machine, progImg, 1e6, turbo) : machine.regs[R.A]; break; }
      if (gate.idle()) break;
    }
    if (dev.halted && exited === null) exited = dev.status;
    return machine.cycle - start;
  }

  const api = {
    arena, machine, dev, mailbox: mb,
    /** guest text output so far (printf) */
    output: ctx.output,
    /** the guest exited (status) or halted; null while resident */
    exited: () => exited,
    send(type, payload = []) {
      if (!mb.send(type, payload)) throw new Error(`coreframe: guest inbox full (type ${type})`);
      // a kernel with a cycle handler takes this as HIRQ_MBOX and schedules; a
      // bare module has no handler and polls -- the count is harmless there.
      // ctx.irq === false leaves the line alone: the kernel's scheduler scan
      // wakes the bound task on its own (kernel.js, wake: 'poll')
      if (ctx.irq !== false) dev.raiseMbox();
    },
    run(maxCycles = 5e6) {
      const cycles = step(maxCycles);
      return { frames: mb.drain(), cycles, idle: gate.idle(), exited };
    },
    /** run until a predicate holds (booting a kernel to its prompt, say) */
    runUntil(pred, maxCycles = 60e6) {
      const start = machine.cycle;
      while (machine.cycle - start < maxCycles && !dev.halted && exited === null) {
        turbo.run(20000, CONS_RET);
        if (machine.regs[R.PC] === CONS_RET) { exited = progImg ? runToExit(machine, progImg, 1e6, turbo) : machine.regs[R.A]; break; }
        if (pred()) return true;
      }
      if (dev.halted && exited === null) exited = dev.status;
      return pred();
    },
    exchange(type, payload = [], maxCycles = 5e6) {
      api.send(type, payload);
      const r = api.run(maxCycles);
      if (!r.idle && r.exited === null) throw new Error(`coreframe: guest did not go idle within ${maxCycles} cycles (type ${type})`);
      return r.frames;
    },
    /** frame type 0 asks the resident loop to return from main */
    shutdown(maxCycles = 5e6) {
      if (exited !== null) return exited;
      mb.send(0, []);
      dev.raiseMbox();
      step(maxCycles);
      if (ctx.onShutdown) ctx.onShutdown(api);
      return exited;
    },
    cycle: () => machine.cycle,
  };
  return api;
}
