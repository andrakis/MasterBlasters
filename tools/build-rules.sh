#!/bin/bash
# build-rules.sh -- compile the rules module (the resident VM process the game
# ships) and its native twin (the same core under c4m32, for the parity test).
# Needs the CoreFrame checkout's build script and the c4 toolchain (C4_ROOT).
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
CF=${COREFRAME:-$here/../CoreFrame}
M=$here/vendor/coreframe/modules
R=$here/src/rules
node "$CF/runtime/frames/gen.mjs" "$R/frames.json" "$R/frames.h" "$R/frames.ts"
mkdir -p "$here/public/coreframe" "$here/test/fixtures"
"$CF/tools/build-module.sh" "$here/public/coreframe/mb_rules.c4r" "$M/cf_mbox.h" "$R/frames.h" "$R/mb_rules_core.c" "$M/cf_main.c"
"$CF/tools/build-module.sh" "$here/test/fixtures/mb_rules_native.c4r" "$M/cf_native.c" "$R/frames.h" "$R/mb_rules_core.c" "$M/cf_native_main.c"
