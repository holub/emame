# eMAME

`emame` aims to provide a general web environment for running anything supported by MAME. The current pages and CI build cover a selected set of machines; broad MAME coverage is the goal. [Emularity](https://github.com/db48x/emularity) is a predecessor project for browser-based emulation.

The repository contains the driver pages, browser loader/theme, per-machine configuration, and a CI workflow that builds MAME `master` merged with the `emame-wip` branch in `holub/mame`.

## Layout

- Top-level `*.html` files are the machine pages; `index.html` is the page directory.
- `mame-loader.js` loads MAME and exposes the browser bridge; `theme-simple.js` owns the page UI.
- `cfg/` and `nvram/` contain seeded per-machine state.
- `roms/` and `software/` are ignored, user-supplied directories. ROMs and software are not included.
- `RESOLUTION.md` documents the per-driver display-size policy.

## Local build and run

Use an Emscripten SDK and a MAME checkout on `emame-wip`. `MAME_SRC` defaults to `../mame/` relative to this repository; set it to another MAME source checkout when needed. `res-info.py` runs `$MAME_SRC/mame` unless `MAME` explicitly overrides the executable. `EMSDK_DIR` defaults to `~/workspace/emsdk`.

```sh
EMSDK_DIR="$HOME/workspace/emsdk" MAME_SRC="$HOME/workspace/mame" ./build.sh
```

`build.sh` builds in `MAME_SRC` and links the generated `mame.html`, `mame.js`, and `mame.wasm` into this web root for local serving. It refuses to replace regular files at those paths; remove or move such files before building.

### `start-web.sh`

`start-web.sh` starts Python's built-in static HTTP server from the emame directory on port 8080. After building, run `./start-web.sh` and open `http://localhost:8080/index.html` (or a machine page such as `tbblue.html`) in a browser. Stop the server with Ctrl+C. ROMs and software must be supplied separately in the ignored `roms/` and `software/` directories.

### `res-info.py`

`res-info.py` checks the page `-resolution` arguments against frame sizes derived from MAME's `-listxml` data and the driver's boot-default view. With no driver arguments it checks every configured page; pass driver short names to limit the check. It prints `OK` or `DIFFERS` per driver and exits nonzero if a page's current resolution differs from the suggestion. If a driver cannot be run because ROMs are missing, it falls back to a 4:3 suggestion. `MAME_SRC` selects the source checkout (default `../mame/`); the binary is `$MAME_SRC/mame`, with `MAME` available to override the executable. Headless runs use `MAME_ROMPATH` when set, otherwise this repository's `roms/` directory if present.

```sh
python3 res-info.py                       # check all configured pages
python3 res-info.py tbblue tsconf2        # check selected drivers
python3 res-info.py --views tbblue         # list the driver's views/default
```

The `--views` mode needs complete ROMs for each selected driver and exits nonzero when a driver cannot run. With no driver arguments, it lists views for all configured drivers.

## Licensing

The emame web-front source is licensed under BSD-3-Clause; see `LICENSE`. CI artifacts also contain MAME binaries. MAME's top-level `COPYING` states that MAME as a whole is GPL-2.0, with individual files potentially under less restrictive licenses. The artifact ships that file as `MAME-COPYING` and the full `docs/legal/` texts as `MAME-LICENSES/`. ROMs and software are user-supplied and may have separate terms.

## Patch set carried on `emame-wip`

These changes are applied on top of `mame/master` by the CI workflow:

- `running_machine` browser bridges (`emscripten_set_bgfx_chain`, `emscripten_resize_window`, `emscripten_set_keepaspect`, `emscripten_set_fastforward`, and `emscripten_cassette_toggle`) plus the cassette tape-end watch.
- Callback-delta run-loop pacing and CPU-bound unthrottled fast-forward.
- Runtime bgfx chain switching through `osd_common_t::set_bgfx_screen_chain`, `renderer_bgfx::set_effect_chain`, `chain_manager::set_chain_by_name`, and `osd_renderer::set_effect_chain`.
- Emscripten `EXPORTED_FUNCTIONS` additions and `emscripten_post.js` cwrap bindings deferred until first call.
- Emscripten buildability updates in `scripts/src/osd/modules.lua` and `src/lib/util/chd.cpp`.
- `js_sound.js` underrun padding uses the last played sample (silence before the first sample), avoiding NaNs.

## Upstream PRs

- [mamedev/mame#15666](https://github.com/mamedev/mame/pull/15666) — broader `js_sound` output-delay changes. The underrun-padding fix is already carried on `emame-wip`; reconcile that overlapping code when the PR lands in `mame/master`.
- [mamedev/mame#16269](https://github.com/mamedev/mame/pull/16269) — run-loop pacing and unthrottled fast-forward, currently carried on `emame-wip`; reconcile the duplicate when the PR lands in `mame/master`.

The CI merge intentionally fails on conflicts, signaling that `emame-wip` needs reconciliation with the updated upstream tree.
