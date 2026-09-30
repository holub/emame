#!/bin/bash
# Local build of the Emscripten target with the same parameters as CI
# (.github/workflows/ci-emscripten.yml).
# EMSDK_DIR and MAME_SRC can override the sibling checkout defaults.
#
# Objects, generated sources, and genie projects live under this repository's
# build/. SEPARATE_BIN keeps the executable target under build/asmjs/bin too;
# the final web artifacts are copied to this repository root for serving.
set -eu
WEB_ROOT=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$WEB_ROOT/build"
# Drop stale symlinks from older builds that pointed into the MAME checkout.
# These outputs are copied from the separate build tree below.
for output in mame.html mame.js mame.wasm; do
  if [ -L "$WEB_ROOT/$output" ]; then
    rm "$WEB_ROOT/$output"
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
export SOURCES="sinclair/sprinter.cpp,sinclair/evo/tsconf.cpp,sinclair/scorpion.cpp,sinclair/next/specnext.cpp,samcoupe/samcoupe.cpp,sinclair/spectrum.cpp,sinclair/spec128.cpp,sinclair/specpls3.cpp,sinclair/atm.cpp,sinclair/byte.cpp,sinclair/evo/pentevo.cpp,sinclair/chloe.cpp,pacman/pacman.cpp,nintendo/dkong.cpp,galaxian/galaxian.cpp"
export SEPARATE_BIN=1
# BUILDDIR must be relative to MAME_SRC: genie.lua composes its paths as
# MAME_DIR .. build-dir, and the makefile resolves $(BUILDDIR) from the
# make invocation directory (MAME_SRC)
export BUILDDIR=$(realpath --relative-to="$MAME_SRC" "$WEB_ROOT/build")
# REGENIE rewrites all *.make files, and every object depends on its
# makefile ($(MAKEFILE) prerequisite), so an unconditional REGENIE=1 ==
# full rebuild every run. Gate it on SOURCES and link inputs instead.
# The --pre-js/--post-js files are link inputs but not make dependencies,
# so a changed stamp forces a relink as well as regenerating the projects.
STAMP_FILE="$WEB_ROOT/build/.build_stamp"
STAMP_INPUTS="$MAME_SRC/scripts/genie.lua $MAME_SRC/src/osd/modules/sound/js_sound.js $MAME_SRC/scripts/resources/emscripten/emscripten_post.js"
STAMP_NEW="$SOURCES SEPARATE_BIN=1 $(cat $STAMP_INPUTS | md5sum | cut -d' ' -f1)"
BIN_DIR="$WEB_ROOT/build/asmjs/bin"
if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$STAMP_NEW" ]; then
  export REGENIE=1
  rm -f "$BIN_DIR/mame.html" "$BIN_DIR/mame.js" "$BIN_DIR/mame.wasm"
  printf '%s' "$STAMP_NEW" > "$STAMP_FILE"
fi
export PRECOMPILE=0
export DEBUG=0
export OPTIMIZE=3
export LDOPTS="-lembind -sASSERTIONS=1"
emmake make -j"$(nproc)"

for output in mame.html mame.js mame.wasm; do
  if [ ! -f "$BIN_DIR/$output" ]; then
    printf 'Build finished but %s was not produced in %s\n' "$output" "$BIN_DIR" >&2
    exit 1
  fi
  cp -f "$BIN_DIR/$output" "$WEB_ROOT/$output"
done
