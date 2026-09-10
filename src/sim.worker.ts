// The worker entry: scheduling and the command queue ONLY — all game state lives
// in src/sim/world.ts. Commands received between wakes are applied at the next
// tick boundary in arrival order. The sim itself never sees wall-clock time, only
// tick counts — that property is what lets the same World class run on a phase-2
// host unchanged.

import { CFG } from './config.ts';
import { World, type Command } from './sim/world.ts';

declare const self: DedicatedWorkerGlobalScope;

const TICK_MS = 1000 / CFG.TICK_HZ;

let world = new World(CFG.SEED);
let queue: Command[] = [];
let paused = false;
let started = false;

let last = 0;
let acc = 0;

// sim tick rate over the last window, for the HUD debug row
let tps = 0;
let tickWindow = 0;
let windowStart = 0;

function loop(): void {
  const now = performance.now();
  if (last === 0) last = now;
  acc += now - last;
  last = now;

  if (paused) {
    acc = 0; // no catch-up burst on resume
  } else {
    let ran = 0;
    while (acc >= TICK_MS && ran < CFG.MAX_CATCHUP) {
      if (queue.length > 0) {
        for (const cmd of queue) world.apply(cmd);
        queue.length = 0;
      }
      world.step();
      acc -= TICK_MS;
      ran++;
      tickWindow++;
    }
    // stalled beyond catch-up (tab hidden, debugger): drop the debt, don't spiral
    if (acc >= TICK_MS) acc = acc % TICK_MS;

    if (now - windowStart >= 500) {
      tps = Math.round((tickWindow * 1000) / (now - windowStart));
      tickWindow = 0;
      windowStart = now;
    }

    if (ran > 0) {
      const { msg, transfers } = world.pack();
      msg.simTps = tps;
      self.postMessage(msg, transfers);
    }
  }

  const elapsed = performance.now() - now;
  setTimeout(loop, Math.max(0, TICK_MS - elapsed));
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string } & Record<string, unknown>;
  switch (m.type) {
    case 'init':
      if (!started) {
        started = true;
        windowStart = performance.now();
        loop();
      }
      break;
    case 'pause':
      paused = !!m.paused;
      break;
    default:
      // everything else is a sim command; queued for the next tick boundary
      queue.push(m as unknown as Command);
      break;
  }
};
