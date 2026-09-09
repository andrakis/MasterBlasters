#!/bin/bash
# build-rules.sh -- everything the game ships under public/coreframe/ and the
# parity fixture: the microcode and firmware (from vendor/coreframe), the rules
# module (the resident VM process), and the same core as a native twin.
#
#   tools/build-rules.sh              stock encoding
#   RELEASE_SEED=N tools/build-rules.sh   a per-release opcode encoding: fw.c4r and
#                                     mb_rules.c4r permuted + opnames.rom beside them
#   RELEASE_KEY=~/.coreframe/keys/mb-release.key   sign both images (src/rules/releaseKey.ts
#                                     lists the public half; the worker refuses unsigned images)
#
# Needs the CoreFrame checkout (COREFRAME, default ../CoreFrame) and the c4
# toolchain (C4_ROOT, default ~/git/c4).
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
CF=${COREFRAME:-$here/../CoreFrame}
M=$here/vendor/coreframe/modules
R=$here/src/rules
P=$here/public/coreframe
node "$CF/runtime/frames/gen.mjs" "$R/frames.json" "$R/frames.h" "$R/frames.ts"
mkdir -p "$P" "$here/test/fixtures"
cp "$here/vendor/coreframe/hw/microcode.uc" "$P/microcode.uc"
"$CF/tools/build-module.sh" "$here/test/fixtures/mb_rules_native.c4r" "$M/cf_native.c" "$R/frames.h" "$R/mb_rules_core.c" "$M/cf_native_main.c"
sign_image () {   # sign in place when RELEASE_KEY names the private key
  [ -n "$RELEASE_KEY" ] || return 0
  node "$here/vendor/coreframe/node/sign.js" sign "$RELEASE_KEY" "$1" "$1.signed" > /dev/null && mv "$1.signed" "$1"
}
if [ -n "$RELEASE_SEED" ]; then
  tmp=$(mktemp -d)
  "$CF/tools/build-module.sh" "$tmp/mb_rules.c4r" "$M/cf_mbox.h" "$R/frames.h" "$R/mb_rules_core.c" "$M/cf_main.c"
  "$CF/tools/permute-release.sh" "$RELEASE_SEED" "$P" "$here/vendor/coreframe/fw/fw.c4r" "$tmp/mb_rules.c4r"
  rm -rf "$tmp"
  echo "build-rules: public/coreframe permuted with seed $RELEASE_SEED (opnames.rom)"
  sign_image "$P/fw.c4r"; sign_image "$P/mb_rules.c4r"
else
  cp "$here/vendor/coreframe/fw/fw.c4r" "$P/fw.c4r"
  rm -f "$P/opnames.rom"
  "$CF/tools/build-module.sh" "$P/mb_rules.c4r" "$M/cf_mbox.h" "$R/frames.h" "$R/mb_rules_core.c" "$M/cf_main.c"
  echo "build-rules: public/coreframe stock encoding"
  sign_image "$P/fw.c4r"; sign_image "$P/mb_rules.c4r"
fi
[ -n "$RELEASE_KEY" ] && echo "build-rules: images signed with $RELEASE_KEY"
exit 0
