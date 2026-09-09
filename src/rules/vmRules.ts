// The CoreFrame VM as the rules authority: boots the vendored c4bb host on
// mb_rules.c4r (the resident guest process built from mb_rules_core.c) and
// exposes it through the Rules seam. Works in the sim worker (assets fetched)
// and in node (assets read from public/coreframe) alike.

import { createHost, type Host } from '../../vendor/coreframe/host.js';
import { FrameRules, type Rules } from './rules.ts';

export interface VmAssets { ucSource: string; fwBytes: Uint8Array; progBytes: Uint8Array; opnames?: string | null }

export const VM_ASSET_URLS = { ucSource: 'coreframe/microcode.uc', fwBytes: 'coreframe/fw.c4r', progBytes: 'coreframe/mb_rules.c4r', opnames: 'coreframe/opnames.rom' } as const;

/** an opcode-name ROM is 89 five-byte names; anything else (a dev server's index.html for a missing file) is not one */
export const isOpnamesRom = (s: string) => s.length === 89 * 5 && /^([A-Z0-9_ ]{4},)*[A-Z0-9_ ]{4},?$/.test(s); // C4CF, C4CY, C4IV carry a digit

export async function fetchVmAssets(base = '/'): Promise<VmAssets> {
  const [ucSource, fw, prog, rom] = await Promise.all([
    fetch(base + VM_ASSET_URLS.ucSource).then((r) => { if (!r.ok) throw new Error(`microcode.uc ${r.status}`); return r.text(); }),
    fetch(base + VM_ASSET_URLS.fwBytes).then((r) => { if (!r.ok) throw new Error(`fw.c4r ${r.status}`); return r.arrayBuffer(); }),
    fetch(base + VM_ASSET_URLS.progBytes).then((r) => { if (!r.ok) throw new Error(`mb_rules.c4r ${r.status}`); return r.arrayBuffer(); }),
    // a release build ships a permuted encoding beside the images; a stock build has none
    fetch(base + VM_ASSET_URLS.opnames).then((r) => (r.ok ? r.text() : null)).catch(() => null),
  ]);
  return { ucSource, fwBytes: new Uint8Array(fw), progBytes: new Uint8Array(prog), opnames: rom && isOpnamesRom(rom) ? rom : null };
}

export class VmRules extends FrameRules implements Rules {
  readonly host: Host;
  constructor(assets: VmAssets) {
    const host = createHost({ ...assets, argv: ['mb_rules.c4r'] });
    super({ exchange: (type, payload) => host.exchange(type, payload) });
    this.host = host;
  }
  /** guest cycles consumed so far — the determinism fingerprint */
  cycles() { return this.host.cycle(); }
  dispose() { this.host.shutdown(); }
}
