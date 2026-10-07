# eMAME

`emame` aims to provide a general web environment for running anything supported by MAME. The current pages and CI build cover a selected set of machines; broad MAME coverage is the goal. [Emularity](https://github.com/db48x/emularity) is a predecessor project for browser-based emulation.

The repository contains the driver pages, browser loader/theme, per-machine configuration, and a CI workflow that builds MAME `master` merged with the [`emame-wip` branch](https://github.com/mamedev/mame/compare/master...holub:mame:emame-wip).

## Layout

- Machine configurations live in `machines.json`; the universal `run.html?machine=<key>` page renders any entry, and `index.html` links to them (sections, order and labels are curated there).
- `mame-loader.js` loads MAME and exposes the browser bridge; `theme-simple.js` owns the page UI.
- `cfg/` and `nvram/` contain seeded per-machine state.
- `roms/` and `software/` are ignored, user-supplied directories. ROMs and software are not included.
- `RESOLUTION.md` documents the per-driver display-size policy.

## Local build and run

Use an Emscripten SDK and a MAME checkout on `emame-wip`. `MAME_SRC` defaults to `../mame/` relative to this repository; set it to another MAME source checkout when needed. `EMSDK_DIR` defaults to `~/workspace/emsdk`.

```sh
EMSDK_DIR="$HOME/workspace/emsdk" MAME_SRC="$HOME/workspace/mame" ./build.sh
```

`build.sh` compiles the sources in `MAME_SRC` but keeps objects, generated sources, and genie projects in this repository's `build/` (`BUILDDIR`). `SEPARATE_BIN=1` puts the linked Emscripten target in `build/asmjs/bin/`; the script copies `mame.html`, `mame.js`, and `mame.wasm` to this web root for serving. A native build in the MAME checkout uses its own `build/`, so the two build trees do not clobber each other or force recompiles.
`build.sh` refuses to run unless `MAME_SRC` is on the `emame-wip` branch; pass `--skip-branch-check` to build from another branch anyway.
`BUILDDIR` must stay relative to the MAME checkout: genie composes `MAME_DIR .. BUILDDIR`, so an absolute path generates the makefiles into a bogus tree and the build dies on a missing project file.

### `start-web.sh`

`start-web.sh` starts Python's built-in static HTTP server from the emame directory on port 8080. After building, run `./start-web.sh` and open `http://localhost:8080/index.html` (or a machine page such as `run.html?machine=tbblue`) in a browser. Stop the server with Ctrl+C. ROMs and software must be supplied separately in the ignored `roms/` and `software/` directories.

### Headless CLI (`mame-js`)

`mame-js` runs the Emscripten build on the desktop through node — no browser, no native build. It picks the newest node from `$EMSDK_DIR` (falling back to `node` on `PATH`); the bundle requires node ≥ 18.3. The launcher (`mame-node.mjs`) stubs the `window` object SDL probes at startup and maps host paths into the emscripten filesystem: ROM zips are preloaded from `roms/` by default, and any file/dir argument that exists on the host (`-rompath`, `-autoboot_script`, `-*_directory`) is copied or created at the same path inside MEMFS. Use `--no-rom-preload` to skip the default.

```sh
./mame-js -listxml galaxian            # driver info from the shipped binary
./mame-js -verifyroms frogger          # ROM presence + checksum check
for d in frogger pacman dkong galaxian; do ./mame-js -verifyroms $d || echo "MISSING: $d"; done
```

A single-set `-verifyroms` exits nonzero when the set is missing or bad — that is the reliable ROM-gate form; multi-set invocations skip missing sets silently and may exit zero. Machines also run headless (`-video none -str N`, `-autoboot_script`): SDL additionally probes `screen` and `document` during init, and the launcher stubs those the same way. This is why `validate.py` is js-first — a native checkout is usually a stale subset of the driver list.

### `validate.py`

`validate.py` checks the `resolution` field of each `machines.json` entry against frame sizes derived from MAME's `-listxml` data and the driver's boot-default view. With no arguments it checks every machine; pass machine slugs to limit the check. It searches integer-scaled frames within an 800x900 box, choosing the frame aspect closest to the effective view aspect and preferring the smaller frame on ties, so base dimensions remain the suggestion and configured integer upscales appear as `xM` in `current`. The taller box allows rotated arcade frames such as Frogger's 768x896 candidate; the old 800x600 cap excluded it. The `current` column prints `OK` for an exact match, `xM` for a uniform scale of the suggestion (for example, `x2` or `x1.5`), or the actual resolution when it matches neither.
Rows are printed and flushed as each driver check completes rather than buffered until all drivers finish.

```sh
python3 validate.py                       # check all machines
python3 validate.py tbblue tsconf2-img    # check selected machines
python3 validate.py --views tbblue         # list the driver's views/default
```

The `--views` mode needs complete ROMs for each selected driver and exits nonzero when a driver cannot run. With no driver arguments, it lists views for all configured drivers.

## Adding a machine

1. Add the driver file(s) to `SOURCES` in both `build.sh` and the CI workflow; rebuild.
2. ROM zips go to `roms/` (ignored, supplied per host).
3. Add a `machines.json` entry. The key is the URL slug; `driver` only when it differs. Conventions: `roms` lists bare set names (parents and shared ROMs included, e.g. `kb_ms_natural`); `media` values live under `software/` and mount at their basename; `cfg: true` means `cfg/<driver>.cfg`. `nvram` stays explicit `{url, path}` — sources must be web-cache-unique (same file name fetched from different URLs serves the wrong demo after a cache hit) and may be renamed on the way in, so no convention is possible.
4. `python3 validate.py <slug>` — no `MISSING` lines, and `current` prints `OK` or an integer multiple (`x2`).
5. Link `run.html?machine=<slug>` from `index.html`.

## Licensing

The emame web-front source is licensed under BSD-3-Clause; see `LICENSE`. CI artifacts also contain MAME binaries. MAME's top-level `COPYING` states that MAME as a whole is GPL-2.0, with individual files potentially under less restrictive licenses. The artifact ships that file as `MAME-COPYING` and the full `docs/legal/` texts as `MAME-LICENSES/`. ROMs and software are user-supplied and may have separate terms.

## Patch set carried on `emame-wip`

`emame-wip` is kept rebased on `mame/master`; the CI merge step is only a fallback and intentionally fails on conflicts, signalling that a rebase is due.

- `running_machine` browser bridges (`emscripten_set_bgfx_chain`, `emscripten_resize_window`, `emscripten_set_keepaspect`, `emscripten_set_fastforward`, and `emscripten_cassette_toggle`) plus the cassette tape-end watch.
- `running_machine::emscripten_set_paused` machine pause for the web pages, with the audio sink told about deliberate drain (no false underruns while paused).
- `scripts/src/3rdparty.lua` takes the asmjs toolchain down the clang path of its warning flags.
- Wall-clock master run-loop pacing (MAME's internal throttle stays off) and CPU-budget unthrottled fast-forward.
- Runtime bgfx chain switching through `osd_common_t::set_bgfx_screen_chain`, `renderer_bgfx::set_effect_chain`, `chain_manager::set_chain_by_name`, and `osd_renderer::set_effect_chain`.
- Emscripten `EXPORTED_FUNCTIONS` additions and `emscripten_post.js` cwrap bindings deferred until first call.
- `infoxml.cpp` runs `-listxml` tasks with `std::launch::deferred` on Emscripten (no pthreads; the default `std::launch::async` throws), keeping headless `-listxml` working under node.
- `emscripten_post.js` MEMFS preload hook (`JSMAME.preload`) for the headless node CLI.
- Emscripten buildability updates in `scripts/src/osd/modules.lua` and `src/lib/util/chd.cpp`.
- `js_sound.js` underrun padding uses the last played sample (silence before the first sample), avoiding NaNs.

## Upstream PRs

- [mamedev/mame#15666](https://github.com/mamedev/mame/pull/15666) — broader `js_sound` output-delay changes. The underrun-padding fix is already carried on `emame-wip`; reconcile that overlapping code when the PR lands in `mame/master`.
- [mamedev/mame#16269](https://github.com/mamedev/mame/pull/16269) — run-loop pacing and unthrottled fast-forward, currently carried on `emame-wip`; reconcile the duplicate when the PR lands in `mame/master`.

The CI merge intentionally fails on conflicts, signaling that `emame-wip` needs reconciliation with the updated upstream tree.
