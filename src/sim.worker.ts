// The worker entry: scheduling and the command queue ONLY — all game state lives
// in src/sim/world.ts. Commands received between wakes are applied at the next
// tick boundary in arrival order. The sim itself never sees wall-clock time, only
// tick counts — that property is what lets the same World class run on a phase-2
// host unchanged.
//
// The rules authority is the CoreFrame VM (src/rules/vmRules.ts), booted here
// beside the World before the first message is serviced; anything that arrives
// earlier waits in `pending`.

import { CFG } from './config.ts';
import { World, type Command } from './sim/world.ts';
import { fetchVmAssets, VmRules } from './rules/vmRules.ts';

declare const self: DedicatedWorkerGlobalScope;

const TICK_MS = 1000 / CFG.TICK_HZ;

let world: World | null = null;
let ready = false;
const pending: unknown[] = [];
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
  const w = world!;
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
        for (const cmd of queue) w.apply(cmd);
        queue.length = 0;
      }
      w.step();
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
      const { msg, transfers } = w.pack();
      msg.simTps = tps;
      self.postMessage(msg, transfers);
    }
  }
  // DEV: the OS gets a slice of its own each tick (top, the shell); what it printed goes up
  if (rules?.kernel) { rules.breathe(50000); flushConsole(); }

  const elapsed = performance.now() - now;
  setTimeout(loop, Math.max(0, TICK_MS - elapsed));
}

function handle(m: { type: string } & Record<string, unknown>): void {
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
    case 'rulesDump':
      // DEV: the frame log + replies, for tools/verify-round.mjs
      self.postMessage({ type: 'rulesDump', ...world!.rulesLog });
      break;
    default:
      // everything else is a sim command; queued for the next tick boundary
      queue.push(m as unknown as Command);
      break;
  }
}

let rules: VmRules | null = null;

async function bootRules(debug: boolean): Promise<void> {
  // DEV: the rules under C4KE, with top at the shell -- the tilde console watches the OS
  const assets = await fetchVmAssets(import.meta.env.BASE_URL, { kernel: debug });
  rules = new VmRules(assets);
  world = new World(CFG.SEED, rules);
  if (rules.kernel) { rules.console('top -d 5000 &\n'); rules.breathe(2e6); }
  ready = true;
  for (const m of pending) handle(m as { type: string } & Record<string, unknown>);
  pending.length = 0;
}

/** DEV: what the kernel printed since last time, up to the page */
function flushConsole(): void {
  const text = rules?.takeConsole();
  if (text) self.postMessage({ type: 'console', text });
}

let booting = false;
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string } & Record<string, unknown>;
  if (m.type === 'init' && !booting) {
    booting = true;
    bootRules(!!m.debug).catch((err: unknown) => {
      // no rules, no game: say so loudly rather than run an unscored match
      console.error('sim.worker: the rules VM failed to boot', err);
      self.postMessage({ type: 'rulesError', message: (err as Error).message });
    });
  }
  if (m.type === 'consoleInput') { rules?.console(String(m.text)); return; }
  if (ready) handle(m);
  else pending.push(m);
};
