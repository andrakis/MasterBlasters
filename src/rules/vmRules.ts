// The CoreFrame VM as the rules authority: boots the vendored c4bb host on
// mb_rules.c4r (the resident guest process built from mb_rules_core.c) and
// exposes it through the Rules seam. Works in the sim worker (assets fetched)
// and in node (assets read from public/coreframe) alike.

import { createHost, type Host } from '../../vendor/coreframe/host.js';
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
  return {
    ucSource,
    fwBytes: await verifiedImage(new Uint8Array(fw), 'fw.c4r'),
    progBytes: await verifiedImage(new Uint8Array(prog), 'mb_rules.c4r'),
    opnames: rom && isOpnamesRom(rom) ? rom : null,
  };
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
