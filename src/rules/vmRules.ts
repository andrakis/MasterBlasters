// The CoreFrame VM as the rules authority: boots the vendored c4bb host on
// mb_rules.c4r (the resident guest process built from mb_rules_core.c) and
// exposes it through the Rules seam. Works in the sim worker (assets fetched)
// and in node (assets read from public/coreframe) alike.

import { createHost, type Host } from '../../vendor/coreframe/host.js';
import { createKernelHost, type KernelHost } from '../../vendor/coreframe/kernel.js';
import { verifyImage, splitSigned } from '../../vendor/coreframe/sign.js';
import { FrameRules, type Rules } from './rules.ts';
import { RELEASE_KEYS } from './releaseKey.ts';

const trusted = (): Record<string, Uint8Array> =>
  Object.fromEntries(Object.entries(RELEASE_KEYS).map(([id, hex]) => [id, Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)))]));

/** verify a shipped image against the game's release keys; throws rather than boot a stranger's rules */
export async function verifiedImage(bytes: Uint8Array, what: string): Promise<Uint8Array> {
  const r = await verifyImage(bytes, trusted());
  if (!r.ok || !r.image) throw new Error(`${what}: ${r.reason}`);
  return r.image;
}

/** the bare image (trailer stripped) without verifying -- for node tools that already trust the file on disk */
export const bareImage = (bytes: Uint8Array): Uint8Array => splitSigned(bytes).image;

export interface VmAssets {
  ucSource: string; fwBytes: Uint8Array; progBytes: Uint8Array; opnames?: string | null;
  /** DEV: host the rules under C4KE (the kernel image + its binaries-only disk), so the console can watch the OS */
  kernel?: { kernelBytes: Uint8Array; files: Map<string, Uint8Array> } | null;
}

/** the kernel's disk is listed by public/coreframe/kernel/files.json (build-rules writes it): the four the
 *  kernel needs, top, ps, the rules unit linked for C4KE (mb_rules_k), the vfs manifest, and in dev the
 *  whole C4KE userland (ls, cat, xxd, c4cc, mandel, raycast, …) -- every .c4r verified against the release key */
export interface KernelFiles { kernel: string; disk: string[] }

export const VM_ASSET_URLS = { ucSource: 'coreframe/microcode.uc', fwBytes: 'coreframe/fw.c4r', progBytes: 'coreframe/mb_rules.c4r', opnames: 'coreframe/opnames.rom' } as const;

/** an opcode-name ROM is 89 five-byte names; anything else (a dev server's index.html for a missing file) is not one */
export const isOpnamesRom = (s: string) => s.length === 89 * 5 && /^([A-Z0-9_ ]{4},)*[A-Z0-9_ ]{4},?$/.test(s); // C4CF, C4CY, C4IV carry a digit

export async function fetchVmAssets(base = '/', { kernel = false } = {}): Promise<VmAssets> {
  const [ucSource, fw, prog, rom] = await Promise.all([
    fetch(base + VM_ASSET_URLS.ucSource).then((r) => { if (!r.ok) throw new Error(`microcode.uc ${r.status}`); return r.text(); }),
    fetch(base + VM_ASSET_URLS.fwBytes).then((r) => { if (!r.ok) throw new Error(`fw.c4r ${r.status}`); return r.arrayBuffer(); }),
    fetch(base + VM_ASSET_URLS.progBytes).then((r) => { if (!r.ok) throw new Error(`mb_rules.c4r ${r.status}`); return r.arrayBuffer(); }),
    // a release build ships a permuted encoding beside the images; a stock build has none
    fetch(base + VM_ASSET_URLS.opnames).then((r) => (r.ok ? r.text() : null)).catch(() => null),
  ]);
  const assets: VmAssets = {
    ucSource,
    fwBytes: await verifiedImage(new Uint8Array(fw), 'fw.c4r'),
    progBytes: await verifiedImage(new Uint8Array(prog), 'mb_rules.c4r'),
    opnames: rom && isOpnamesRom(rom) ? rom : null,
  };
  if (kernel) {
    const list = await fetch(base + 'coreframe/kernel/files.json').then((r) => { if (!r.ok) throw new Error(`kernel/files.json ${r.status}`); return r.json() as Promise<KernelFiles>; });
    const get = async (path: string) => {
      const r = await fetch(base + 'coreframe/kernel/' + path);
      if (!r.ok) throw new Error(`kernel/${path} ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      return path.endsWith('.c4r') ? verifiedImage(bytes, path) : bytes;   // the vfs manifest is text
    };
    const files = new Map<string, Uint8Array>();
    await Promise.all(list.disk.map(async (p) => files.set(p.slice(p.lastIndexOf('/') + 1), await get(p))));
    assets.kernel = { kernelBytes: await get(list.kernel), files };
  }
  return assets;
}

export class VmRules extends FrameRules implements Rules {
  readonly host: Host | KernelHost;
  /** under C4KE (DEV): the console is live and the kernel needs cycles of its own each tick */
  readonly kernel: KernelHost | null;
  constructor(assets: VmAssets) {
    let host: Host | KernelHost;
    let kernel: KernelHost | null = null;
    if (assets.kernel) {
      const files = new Map(assets.kernel.files);
      // the module (its C4KE build, on the disk) as a background job, so c4sh keeps its prompt; the clock follows real time so
      // `top -d 5000` refreshes every 5 s of the player's time. Not attested (the kernel host does
      // not do that yet) and not cycle-deterministic: the replay verifier uses the bare host
      const buf = { s: '' };
      kernel = createKernelHost({ ucSource: assets.ucSource, fwBytes: assets.fwBytes, kernelBytes: assets.kernel.kernelBytes, files, program: 'mb_rules_k.c4r &', opnames: assets.opnames ?? null, clock: 'wall', wake: 'poll', onByte: (b) => { buf.s += String.fromCharCode(b); } });
      host = kernel;
      super({ exchange: (type, payload) => host.exchange(type, payload) });
      this.consoleBufRef = buf;
    } else {
      host = createHost({ ...assets, argv: ['mb_rules.c4r'] });
      super({ exchange: (type, payload) => host.exchange(type, payload) });
      this.consoleBufRef = { s: '' };
    }
    this.host = host;
    this.kernel = kernel;
  }
  private consoleBufRef: { s: string };
  /** guest cycles consumed so far — the determinism fingerprint */
  cycles() { return this.host.cycle(); }
  /** DEV: give the OS a slice for its own tasks (top, the shell) — cheap when it is idle */
  breathe(maxCycles = 50000) { return this.kernel ? this.kernel.breathe(maxCycles) : 0; }
  /** DEV: type at c4sh */
  console(text: string) { this.kernel?.console(text); }
  /** DEV: what the kernel printed since the last call */
  takeConsole(): string { const t = this.consoleBufRef.s; this.consoleBufRef.s = ''; return t; }
  dispose() { this.host.shutdown(); }
}
