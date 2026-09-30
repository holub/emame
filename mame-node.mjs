#!/usr/bin/env node
// mame-node.mjs — run the Emscripten MAME build headless (node, no browser).
//
// The wasm build supports node natively; two shims make CLI use work:
//   * a `window` stub — SDL reads window.location.search for SDL_* URL
//     parameters during SDL_Init, even for -listxml/-verifyroms;
//   * MEMFS mapping of host paths — MAME's file I/O only sees the
//     emscripten filesystem, so ROM zips, autoboot scripts and the like
//     must be copied in before main() runs (JSMAME.preload hook).
// Both are applied between module evaluation and main(), which is
// deterministic: the module body runs synchronously at import, while wasm
// instantiation and callMain() happen later on the async promise chain.
//
// Usage: node mame-node.mjs [--no-rom-preload] <mame args...>
//   node mame-node.mjs -listxml galaxian
//   node mame-node.mjs -verifyroms galaxian
// Path arguments are mapped when the host path exists: existing files are
// copied into MEMFS at the same path, existing dirs are created (a -rompath
// dir also gets its *.zip contents preloaded). By default the ./roms folder
// is preloaded and passed as -rompath unless one is already set.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const preload = !args.includes("--no-rom-preload");
const mameArgs = args.filter(a => a !== "--no-rom-preload");

// host paths collected for the MEMFS preload hook
const memDirs = [];
const memFiles = [];

const isHostFile = p => { try { return statSync(p).isFile(); } catch { return false; } };
const isHostDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const addHostDir = (d, withZips) => {
	memDirs.push(d);
	if (withZips)
		for (const name of readdirSync(d).sort())
			if (name.endsWith(".zip") && isHostFile(join(d, name)))
				memFiles.push([join(d, name), new Uint8Array(readFileSync(join(d, name)))]);
};

// map file/dir arguments (rompath may be a colon-separated list)
for (let i = 0; i + 1 < mameArgs.length; i++) {
	if (!mameArgs[i].startsWith("-"))
		continue;
	const vals = mameArgs[i + 1].split(":");
	if (mameArgs[i] === "-rompath") {
		for (const v of vals)
			if (v && isHostDir(v))
				addHostDir(v, true);
	} else if (mameArgs[i].endsWith("_directory")) {
		for (const v of vals)
			if (v && isHostDir(v))
				addHostDir(v, false);
	} else {
		for (const v of vals)
			if (v && isHostFile(v))
				memFiles.push([v, new Uint8Array(readFileSync(v))]);
	}
}

// default: preload ./roms and point MAME at it unless a rompath is set
if (preload) {
	const roms = join(here, "roms");
	if (isHostDir(roms) && !mameArgs.some(a => a === "-rompath" || a.startsWith("-rompath"))) {
		addHostDir(roms, true);
		mameArgs.push("-rompath", roms);
	}
}

process.argv = [process.argv[0], join(here, "mame.js"), ...mameArgs];

await import(pathToFileURL(join(here, "mame.js")).href);

// module body has run (ENVIRONMENT_IS_WEB stayed false); main() has not
globalThis.window = { location: { search: "" } };
if (globalThis.JSMAME && (memFiles.length || memDirs.length))
	globalThis.JSMAME.preload = { files: memFiles, dirs: memDirs };
