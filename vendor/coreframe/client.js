// vendored from CoreFrame/runtime/client.js @ cdb0483 -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
// client.js - the page's side of the worker host: the same send/receive shape
// as host.js, but the machine runs on another thread and a call never blocks.
//
//   const vm = await createWorkerHost({ ucSource, fwBytes, progBytes, worker });
//   vm.send(type, payload);                 written straight into guest RAM, the worker kicked
//   vm.onReply((frame) => ...);             replies as the worker reports them
//   vm.drain()  -> frames                   or pull them yourself (per animation frame)
//   await vm.request(type, payload)         one frame in, the next reply out
//   vm.state()  -> 'booting'|'running'|'idle'|'exited'; vm.cycle(); vm.terminate()
//
// `worker` is the Worker to use (browser: new Worker(new URL('./worker.js',
// import.meta.url), {type:'module'}); node: new Worker(fileURLToPath(...))),
// because each host constructs workers its own way. The page needs
// cross-origin isolation (COOP/COEP) for the SharedArrayBuffer.

import { HostMailbox } from './sim/mbox.js';
import { CTRL_KICK, CTRL_SEQ, CTRL_STATE, CTRL_EXIT, CTRL_CYCLES_LO, CTRL_CYCLES_HI, CTRL_WORDS, STATE_BOOT, STATE_RUNNING, STATE_IDLE, STATE_EXITED } from './ctrl.js';

const STATE_NAMES = ['booting', 'running', 'idle', 'exited'];

// a HostMailbox over rings the WORKER laid out: the constructor would zero the
// headers again, so build the object without it
function attach(arena, region) {
  const mb = Object.create(HostMailbox.prototype);
  mb.arena = arena; mb.base = region.base; mb.len = region.len;
  const half = region.len >> 1;
  mb.toGuest = { at: region.base >> 2, cap: (half >> 2) - 3 };
  mb.toHost = { at: (region.base + half) >> 2, cap: (half >> 2) - 3 };
  mb.seq = 0;
  return mb;
}

export function createWorkerHost({ ucSource, fwBytes, progBytes, argv, worker, arenaBytes = 4 << 20, mboxBytes = 64 << 10, opnames = null, attest = true }) {
  if (typeof SharedArrayBuffer === 'undefined') throw new Error('coreframe: SharedArrayBuffer unavailable (the page needs COOP/COEP)');
  const sab = new SharedArrayBuffer(arenaBytes);
  const ctrlSab = new SharedArrayBuffer(CTRL_WORDS * 4);
  const ctrl = new Int32Array(ctrlSab);
  const arena = { i32: new Int32Array(sab), u8: new Uint8Array(sab) };
  const listeners = new Set();
  const pending = [];
  let mb = null;
  let output = '';
  let attested = null;
  const post = (m) => worker.postMessage(m);
  const onMessage = (fn) => { if ('on' in worker && typeof worker.on === 'function') worker.on('message', fn); else worker.onmessage = (e) => fn(e.data); };

  const drain = () => {
    if (!mb) return [];
    Atomics.load(ctrl, CTRL_SEQ);              // acquire: everything the worker stored before its last slice
    const frames = mb.drain();
    for (const f of frames) for (const l of listeners) l(f);
    return frames;
  };

  const ready = new Promise((resolve, reject) => {
    onMessage((m) => {
      if (m.type === 'ready') { mb = attach(arena, m.mbox); attested = m.attested ?? null; resolve(); }
      else if (m.type === 'replies') { const fs = drain(); for (const f of fs) { const p = pending.shift(); if (p) p.resolve(f); } }
      else if (m.type === 'output') output += m.text;
      else if (m.type === 'error') reject(new Error(m.message));
      else if (m.type === 'exited') {
        const fs = drain(); for (const f of fs) { const p = pending.shift(); if (p) p.resolve(f); }
        // requests the guest will never answer now
        for (const p of pending.splice(0)) p.reject(new Error(`coreframe: guest exited (status ${m.status}) before replying`));
      }
    });
  });
  post({ type: 'boot', ucSource, fwBytes, progBytes, argv, sab, ctrlSab, mboxBytes, opnames, attest });

  const api = {
    ready,
    send(type, payload = []) {
      if (!mb) throw new Error('coreframe: not ready');
      if (!mb.send(type, payload)) throw new Error(`coreframe: guest inbox full (type ${type})`);
      Atomics.add(ctrl, CTRL_KICK, 1);
      Atomics.notify(ctrl, CTRL_KICK);
    },
    request(type, payload = []) {
      return new Promise((resolve, reject) => { pending.push({ resolve, reject }); api.send(type, payload); });
    },
    onReply(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    drain,
    state: () => STATE_NAMES[Atomics.load(ctrl, CTRL_STATE)] ?? 'booting',
    exitStatus: () => (Atomics.load(ctrl, CTRL_STATE) === STATE_EXITED ? Atomics.load(ctrl, CTRL_EXIT) : null),
    cycle: () => Atomics.load(ctrl, CTRL_CYCLES_HI) * 0x100000000 + (Atomics.load(ctrl, CTRL_CYCLES_LO) >>> 0),
    output: () => output,
    /** the SHA-256 (hex) the guest attested its image to, or null when attestation is off */
    attested: () => attested,
    terminate() { worker.terminate(); },
  };
  return api;
}

export { STATE_BOOT, STATE_RUNNING, STATE_IDLE, STATE_EXITED };
