#!/bin/bash
# Local build of the Emscripten target with the same parameters as CI
# (.github/workflows/ci-emscripten.yml).
# EMSDK_DIR and MAME_SRC can override the sibling checkout defaults.
set -eu
WEB_ROOT=$(cd "$(dirname "$0")" && pwd)
for output in mame.html mame.js mame.wasm; do
  if [ -e "$WEB_ROOT/$output" ] && [ ! -L "$WEB_ROOT/$output" ]; then
    printf 'Refusing to replace existing file: %s\n' "$WEB_ROOT/$output" >&2
    exit 1
  fi
done
EMSDK_DIR="${EMSDK_DIR:-$HOME/workspace/emsdk}"
. "$EMSDK_DIR/emsdk_env.sh"
MAME_SRC="${MAME_SRC:-$WEB_ROOT/../mame}"
MAME_SRC=$(cd "$MAME_SRC" && pwd)
cd "$MAME_SRC"
if command -v ccache >/dev/null 2>&1; then
	export OVERRIDE_CC="ccache emcc"
	export OVERRIDE_CXX="ccache em++"
fi
export SUBTARGET=mame
export SOURCES="sinclair/sprinter.cpp,sinclair/evo/tsconf.cpp,sinclair/scorpion.cpp,sinclair/next/specnext.cpp,samcoupe/samcoupe.cpp,sinclair/spectrum.cpp,sinclair/spec128.cpp,sinclair/specpls3.cpp,sinclair/atm.cpp,sinclair/byte.cpp,sinclair/evo/pentevo.cpp,sinclair/chloe.cpp"
export TOOLS=0
# REGENIE rewrites all *.make files, and every object depends on its
# makefile ($(MAKEFILE) prerequisite), so an unconditional REGENIE=1 ==
# full rebuild every run. Gate it on a stamp of the inputs instead:
# regen when SOURCES or genie.lua changed (guarantees the requested
# driver set), otherwise stay incremental.
STAMP_FILE="$MAME_SRC/build/.build_stamp"
STAMP_NEW="$SOURCES $(md5sum "$MAME_SRC/scripts/genie.lua" | cut -d' ' -f1)"
if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$STAMP_NEW" ]; then
  export REGENIE=1
  printf '%s' "$STAMP_NEW" > "$STAMP_FILE"
fi
export PRECOMPILE=0
export DEBUG=0
export OPTIMIZE=3
export LDOPTS="-lembind -sASSERTIONS=1"
emmake make -j"$(nproc)"

for output in mame.html mame.js mame.wasm; do
  ln -sfn "$MAME_SRC/$output" "$WEB_ROOT/$output"
done
