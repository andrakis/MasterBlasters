// The CoreFrame VM as the rules authority: boots the vendored c4bb host on
// mb_rules.c4r (the resident guest process built from mb_rules_core.c) and
// exposes it through the Rules seam. Works in the sim worker (assets fetched)
// and in node (assets read from public/coreframe) alike.

import { createHost, type Host } from '../../vendor/coreframe/host.js';
import { FrameRules, type Rules } from './rules.ts';

export interface VmAssets { ucSource: string; fwBytes: Uint8Array; progBytes: Uint8Array }

export const VM_ASSET_URLS = { ucSource: 'coreframe/microcode.uc', fwBytes: 'coreframe/fw.c4r', progBytes: 'coreframe/mb_rules.c4r' } as const;

export async function fetchVmAssets(base = '/'): Promise<VmAssets> {
  const [ucSource, fw, prog] = await Promise.all([
    fetch(base + VM_ASSET_URLS.ucSource).then((r) => { if (!r.ok) throw new Error(`microcode.uc ${r.status}`); return r.text(); }),
    fetch(base + VM_ASSET_URLS.fwBytes).then((r) => { if (!r.ok) throw new Error(`fw.c4r ${r.status}`); return r.arrayBuffer(); }),
    fetch(base + VM_ASSET_URLS.progBytes).then((r) => { if (!r.ok) throw new Error(`mb_rules.c4r ${r.status}`); return r.arrayBuffer(); }),
  ]);
  return { ucSource, fwBytes: new Uint8Array(fw), progBytes: new Uint8Array(prog) };
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
