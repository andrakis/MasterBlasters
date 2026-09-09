// The public keys the game trusts for its VM images (public/coreframe/*.c4r).
// The private half lives OUTSIDE the repo (~/.coreframe/keys/mb-release.key,
// tools/build-rules.sh signs with RELEASE_KEY=<path>); the CoreFrame service
// (M5) will hold it instead. Raw Ed25519 public keys, hex, by key id.
//
// With any key listed, the worker REFUSES unsigned or mistrusted images: a
// copied bundle cannot swap in its own rules. An empty map means development.
export const RELEASE_KEYS: Record<string, string> = {
  '16629139081014a8': '6889f3566017ceef04f94c490639547d1c91d6454d70463441652cefd24ab94a',
};
