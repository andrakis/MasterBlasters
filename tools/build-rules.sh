#!/bin/bash
# build-rules.sh -- everything the game ships under public/coreframe/ and the
# parity fixture: the microcode and firmware (from vendor/coreframe), the rules
# module (the resident VM process), and the same core as a native twin.
#
#   tools/build-rules.sh              stock encoding
#   RELEASE_SEED=N tools/build-rules.sh   a per-release opcode encoding: fw.c4r and
#                                     mb_rules.c4r permuted + opnames.rom beside them
#   RELEASE_KEY=~/.coreframe/keys/mb-release.key   sign every image (src/rules/releaseKey.ts
#                                     lists the public half; the worker refuses unsigned images)
#
# Also ships the kernel and its binaries-only disk under public/coreframe/kernel/
# (c4ke32.c4r, disk/{init,c4sh,c4ke.vfs,vfsload,top,ps}.c4r): DEV builds and ?debug run
# the rules under C4KE so the tilde console can watch the OS. Permuted and signed like
# the rest.
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
sign_image () {   # sign in place when RELEASE_KEY names the private key
  [ -n "$RELEASE_KEY" ] || return 0
  node "$here/vendor/coreframe/node/sign.js" sign "$RELEASE_KEY" "$1" "$1.signed" > /dev/null && mv "$1.signed" "$1"
}
K=$here/vendor/coreframe/kernel
disk=(init c4sh c4ke.vfs vfsload top ps)
userland=($(cd "$K/userland" && ls *.c4r | sed 's/\.c4r$//'))
mkdir -p "$P/kernel/disk" "$P/kernel/userland"
rm -f "$P"/kernel/userland/*.c4r
# the same rules unit linked for C4KE (cf_kmain.c: the kernel's mailbox opcodes, prints "cf: bound")
ktmp=$(mktemp -d)
"$CF/tools/build-module.sh" "$ktmp/mb_rules_k.c4r" "$R/mb_rules_core.c" "$M/cf_kmain.c"
if [ -n "$RELEASE_SEED" ]; then
  tmp=$(mktemp -d)
  # the kernel + disk with the same encoding (permute-release writes flat into a dir: sort them after)
  kt=$(mktemp -d)
  "$CF/tools/permute-release.sh" "$RELEASE_SEED" "$kt" "$here/vendor/coreframe/fw/fw.c4r" "$K/c4ke32.c4r" "$ktmp/mb_rules_k.c4r" $(for d in "${disk[@]}"; do echo "$K/disk/$d.c4r"; done) $(for u in "${userland[@]}"; do echo "$K/userland/$u.c4r"; done) > /dev/null
  cp "$kt/c4ke32.c4r" "$P/kernel/c4ke32.c4r"
  cp "$kt/mb_rules_k.c4r" "$P/kernel/disk/mb_rules_k.c4r"
  for d in "${disk[@]}"; do cp "$kt/$d.c4r" "$P/kernel/disk/$d.c4r"; done
  for u in "${userland[@]}"; do cp "$kt/$u.c4r" "$P/kernel/userland/$u.c4r"; done
  rm -rf "$kt"
  "$CF/tools/build-module.sh" "$tmp/mb_rules.c4r" "$R/mb_rules_core.c" "$M/cf_mbox.c" "$M/cf_sha256.c" "$M/cf_main.c"
  "$CF/tools/permute-release.sh" "$RELEASE_SEED" "$P" "$here/vendor/coreframe/fw/fw.c4r" "$tmp/mb_rules.c4r"
  rm -rf "$tmp"
  echo "build-rules: public/coreframe permuted with seed $RELEASE_SEED (opnames.rom), kernel + disk too"
  sign_image "$P/fw.c4r"; sign_image "$P/mb_rules.c4r"
else
  cp "$here/vendor/coreframe/fw/fw.c4r" "$P/fw.c4r"
  cp "$K/c4ke32.c4r" "$P/kernel/c4ke32.c4r"
  cp "$ktmp/mb_rules_k.c4r" "$P/kernel/disk/mb_rules_k.c4r"
  for d in "${disk[@]}"; do cp "$K/disk/$d.c4r" "$P/kernel/disk/$d.c4r"; done
  for u in "${userland[@]}"; do cp "$K/userland/$u.c4r" "$P/kernel/userland/$u.c4r"; done
  rm -f "$P/opnames.rom"
  "$CF/tools/build-module.sh" "$P/mb_rules.c4r" "$R/mb_rules_core.c" "$M/cf_mbox.c" "$M/cf_sha256.c" "$M/cf_main.c"
  echo "build-rules: public/coreframe stock encoding"
  sign_image "$P/fw.c4r"; sign_image "$P/mb_rules.c4r"
fi
sign_image "$P/kernel/c4ke32.c4r"; sign_image "$P/kernel/disk/mb_rules_k.c4r"; for d in "${disk[@]}"; do sign_image "$P/kernel/disk/$d.c4r"; done
for u in "${userland[@]}"; do sign_image "$P/kernel/userland/$u.c4r"; done
# the vfs manifest (text, binaries only) and the list the worker fetches
cp "$K/c4ke.vfs.txt" "$P/kernel/disk/c4ke.vfs.txt"
{ echo '{ "kernel": "c4ke32.c4r", "disk": ['; first=1
  for f in $(cd "$P/kernel" && ls disk/*.c4r disk/c4ke.vfs.txt userland/*.c4r); do [ $first = 1 ] || echo ','; first=0; printf '  "%s"' "$f"; done
  echo; echo '] }'; } > "$P/kernel/files.json"
echo "build-rules: kernel disk ${#disk[@]} + module + manifest, userland ${#userland[@]} binaries (public/coreframe/kernel/files.json)"
rm -rf "$ktmp"
# the native twin last: the same rules unit against the parity harness
"$CF/tools/build-module.sh" "$here/test/fixtures/mb_rules_native.c4r" "$R/mb_rules_core.c" "$M/cf_native.c"
[ -n "$RELEASE_KEY" ] && echo "build-rules: images signed with $RELEASE_KEY"
exit 0
