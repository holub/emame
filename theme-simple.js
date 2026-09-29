// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, Andrei I. Holub

// MAMEThemeSimple: stock page theme for MAME emscripten drivers.
//
// Owns everything presentational: DOM, CSS, UI hooks (reset/nmi/fullscreen/
// mute/fps/bgfx chains/joystick), the one-shot display frame, and the asset
// cache name.
// The driver page keeps only its config (driver/files/args/display) and one
// mount() call, e.g.:
//
//   MAMEThemeSimple.mount(document.getElementById("app"), {
//     driver: "tbblue",
//     files: [ { url: "roms/tbblue.zip", path: "roms/tbblue.zip" },
//              { url: "software/next.chd", path: "next.chd" } ],
//     args: ["-window",
//            "-video", "bgfx", "-bgfx_screen_chains", "unfiltered",
//            "-resolution", "720x576",
//            "-nokeepaspect",
//            "-hard1", "next.chd"],
 //
// diffDir defaults to true (harmless empty dir when no writable image is
// mounted); set false to skip. bgfxInitialChain defaults to "unfiltered";
// set another chain, or null to leave MAME's default chain alone.
// Scaling args belong to the page. Pass "-nokeepaspect" for square
// window-mode target pixels (resolution an exact multiple of the driver's
// square-pixel base window, e.g. 720x576 for tbblue/tsconf2, matches
// -nounevenstretch pixel-for-pixel; the theme only watches for that arg to
// restore fill after fullscreen — fs keeps aspect). Pass "-resolution WxH"
// for the windowed frame: WxH is in device pixels (desktop semantics); SDL
// sizes windows in CSS points, so the theme re-issues it divided by
// devicePixelRatio and the canvas backing lands on WxH at any dpr. Without
// these the page keeps stock MAME CRT aspect in a viewport-sized window.
 //
 // config.cache overrides the default asset cache name when given.
var MAMEThemeSimple = (function () {
  var CACHE_PREFIX = "mame-simple-v1-";

  var CSS = [
    "body {",
    "  background-color: #2a4e96;",
    "  font-family: sans-serif;",
    "  color: #fff;",
    "}",
    "canvas.emscripten {",
    "    border: 0 none;",
    "    background-color: #000;",
    "    display: block;",
    "    margin: 0 auto;",
    "    width: calc(100% * 2 / 3);",
    "    aspect-ratio: 4 / 3;",
    "    height: auto;",
    "    image-rendering: pixelated;",
    "    image-rendering: crisp-edges;",
    "}",
    "#emulator-screen {",
    "  position: relative;",
    "  display: block;",
    "  background: #000;",
    "}",
    "#emulator-screen:fullscreen, #emulator-screen.fs-fallback {",
    "  width: 100vw;",
    "  height: 100vh;",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: center;",
    "}",
    "#emulator-screen.fs-fallback {",
    "  position: fixed;",
    "  top: 0;",
    "  left: 0;",
    "  z-index: 9999;",
    "}",
    "#emulator-screen:fullscreen canvas, #emulator-screen.fs-fallback canvas {",
    "  width: 100%;",
    "  height: 100%;",
    "  max-width: none;",
    "  aspect-ratio: auto;",
    "  object-fit: contain;",
    "}",
    "body.fs-lock {",
    "  overflow: hidden;",
    "}",
    "#joystick-controls {",
    "  display: none;",
    "}",
    "#emulator-screen:fullscreen #joystick-controls, #emulator-screen.fs-fallback #joystick-controls {",
    "  position: absolute;",
    "  right: 0;",
    "  bottom: max(12px, env(safe-area-inset-bottom));",
    "  left: 0;",
    "  display: none;",
    "  justify-content: space-between;",
    "  align-items: flex-end;",
    "  padding: 0 16px;",
    "  touch-action: none;",
    "}",
    "#emulator-screen:fullscreen.show-touch #joystick-controls, #emulator-screen.fs-fallback.show-touch #joystick-controls {",
    "  display: flex;",
    "}",
    "#touch-toggle {",
    "  display: none;",
    "}",
    "#fs-reset {",
    "  display: none;",
    "}",
    "#emulator-screen:fullscreen #touch-toggle, #emulator-screen.fs-fallback #touch-toggle {",
    "  position: absolute;",
    "  top: max(10px, env(safe-area-inset-top));",
    "  right: 12px;",
    "  display: block;",
    "  z-index: 2;",
    "  padding: 6px 10px;",
    "  border: 1px solid rgba(170, 170, 170, 0.6);",
    "  border-radius: 8px;",
    "  background: rgba(51, 51, 51, 0.45);",
    "  color: rgba(255, 255, 255, 0.9);",
    "  font-size: 14px;",
    "  cursor: pointer;",
    "}",
    "#emulator-screen:fullscreen #fs-reset, #emulator-screen.fs-fallback #fs-reset {",
    "  position: absolute;",
    "  top: max(10px, env(safe-area-inset-top));",
    "  left: 12px;",
    "  display: block;",
    "  z-index: 2;",
    "  padding: 6px 10px;",
    "  border: 1px solid rgba(170, 170, 170, 0.6);",
    "  border-radius: 8px;",
    "  background: rgba(51, 51, 51, 0.45);",
    "  color: rgba(255, 255, 255, 0.9);",
    "  font-size: 14px;",
    "  cursor: pointer;",
    "}",
    "#joystick-controls .dpad {",
    "  display: grid;",
    "  grid-template-columns: repeat(3, 64px);",
    "  grid-auto-rows: 52px;",
    "  gap: 6px;",
    "}",
    '#joystick-controls .dpad [data-joystick-key="up"] { grid-column: 2; grid-row: 1; }',
    '#joystick-controls .dpad [data-joystick-key="left"] { grid-column: 1; grid-row: 2; }',
    '#joystick-controls .dpad [data-joystick-key="right"] { grid-column: 3; grid-row: 2; }',
    '#joystick-controls .dpad [data-joystick-key="down"] { grid-column: 2; grid-row: 3; }',
    "#joystick-controls .fire-buttons {",
    "  display: flex;",
    "  gap: 88px;",
    "}",
    "/* Narrow portrait phones: side-by-side A/B overflows, stack A above B */",
    "@media (max-width: 500px) {",
    "  #joystick-controls .fire-buttons {",
    "    flex-direction: column;",
    "    gap: 12px;",
    "  }",
    "}",
    "#joystick-controls .fire-buttons button {",
    "  min-width: 88px;",
    "  min-height: 88px;",
    "  border-radius: 50%;",
    "  font-size: 18px;",
    "}",
    "#joystick-controls button {",
    "  min-width: 58px;",
    "  min-height: 48px;",
    "  border: 1px solid rgba(170, 170, 170, 0.6);",
    "  border-radius: 8px;",
    "  background: rgba(51, 51, 51, 0.45);",
    "  color: rgba(255, 255, 255, 0.9);",
    "  font-size: 22px;",
    "  touch-action: none;",
    "}",
    "#joystick-controls button.pressed {",
    "  background: rgba(51, 51, 51, 1);",
    "  border-color: rgba(255, 255, 255, 0.9);",
    "}",
    "#status {",
    "  text-align: center;",
    "  margin-top: 10px;",
    "  min-height: 1.5em;",
    "}",
    "#loadbar {",
    "  display: none;",
    "  width: 320px;",
    "  max-width: 80vw;",
    "  height: 10px;",
    "  margin: 8px auto 0;",
    "  border: 1px solid #aaa;",
    "  border-radius: 5px;",
    "}",
    "#loadbar > div {",
    "  height: 100%;",
    "  width: 0;",
    "  background: #7fb2ff;",
    "  border-radius: 4px;",
    "}",
    "#controls {",
    "  text-align: center;",
    "  margin-top: 10px;",
    "}",
    "#controls span {",
      "margin: 0 8px;",
      "cursor: pointer;",
      "text-decoration: underline;",
    "}",
    "#controls span.on {",
      "  color: #7fb2ff;",
      "  font-weight: bold;",
    "}",
  ].join("\n");

  // On-screen joystick: inject keys the way the browser delivers them. The
  // KeyboardEvent constructor ignores keyCode/which (they read 0), and a
  var defaultKeys = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", fireA: "Space", fireB: "Enter", nmi: "F12" };
  var keyCodes = defaultKeys;
  // Fullscreen touch schemes, cycled by the Controls button. Order is
  // Up Down Left Right A B.
  var keySchemes = {
    kemp: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", fireA: "Enter", fireB: "Space" },
    qaop: { up: "KeyQ", down: "KeyA", left: "KeyO", right: "KeyP", fireA: "KeyM", fireB: "Space" },
    sinclair1: { up: "Digit9", down: "Digit8", left: "Digit6", right: "Digit7", fireA: "Enter", fireB: "Digit0" },
  };
  var schemeOrder = ["kemp", "qaop", "sinclair1"];
  var domKeyCodes = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Space: 32, F12: 123,
    KeyQ: 81, KeyA: 65, KeyO: 79, KeyP: 80, KeyM: 77, Digit9: 57, Digit8: 56, Digit6: 54, Digit7: 55, Digit0: 48 };

  function ensureCss() {
    if (document.getElementById("mame-simple-css")) return;
    var style = document.createElement("style");
    style.id = "mame-simple-css";
    style.textContent = CSS;
    document.getElementsByTagName("head")[0].appendChild(style);
  }

  function buildDom(root, config) {
    var chains = config.bgfxChains || [{ chain: "unfiltered", label: "Unfiltered" }, { chain: "crt-geom-deluxe", label: "CRT Filter" }];
    var chainHtml = chains.map(function (c) {
      return '<span data-bgfx-chain="' + c.chain + '">' + c.label + "</span>";
    }).join("");
    root.innerHTML =
      '<div id="controls">' +
        '<span id="reset">Reset</span>' +
        (config.nmi === true ? '<span id="nmi">NMI</span>' : '') +
        '<span id="fullscr">Full Screen</span>' +
        '<span id="mute">Mute</span>' +
        '<span id="fps">FPS</span>' +
        '<span id="fast">Fast</span>' +
        ((config.args || []).indexOf("-cassette") !== -1 ? '<span id="tape">Tape</span>' : '') +
        chainHtml +
      "</div>" +
      '<div id="emulator-screen">' +
        '<canvas id="canvas" class="emscripten" width="720" height="540" style="visibility:hidden"></canvas>' +
        '<span id="touch-toggle">Controls</span>' +
        '<span id="fs-reset">Reset</span>' +
        '<div id="joystick-controls" aria-label="Joystick controls">' +
          '<div class="dpad">' +
            '<button type="button" data-joystick-key="up" aria-label="Up">▲</button>' +
            '<button type="button" data-joystick-key="left" aria-label="Left">◀</button>' +
            '<button type="button" data-joystick-key="right" aria-label="Right">▶</button>' +
            '<button type="button" data-joystick-key="down" aria-label="Down">▼</button>' +
          "</div>" +
          '<div class="fire-buttons">' +
            '<button type="button" data-joystick-key="fireA" aria-label="A">A</button>' +
            '<button type="button" data-joystick-key="fireB" aria-label="B">B</button>' +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div id="status">Loading...</div>' +
      '<div id="loadbar"><div></div></div>';
  }
  function mount(root, config) {
    ensureCss();
    buildDom(root, config);

    var canvas = root.querySelector("#canvas");
    var screen = root.querySelector("#emulator-screen");
    var status = root.querySelector("#status");
    var loadbar = root.querySelector("#loadbar");
    // Windowed frame: taken from the page's explicit "-resolution WxH" arg
    // (device pixels, res-info.py values). It sizes the canvas backing (the
    // render target) and the windowed CSS box. MAME window sizes are CSS
    // points — SDL multiplies them by devicePixelRatio for the backing — so
    // the theme strips the arg and re-issues it as frame/dpr points to land
    // the backing exactly on the frame.
    var frameW = 0, frameH = 0;
    var pageArgs = (config.args || []).slice();
    for (var i = 0; i < pageArgs.length - 1; i++) {
      if (pageArgs[i] !== "-resolution") continue;
      var m = /^(\d+)x(\d+)$/.exec(String(pageArgs[i + 1]));
      if (m) { frameW = +m[1]; frameH = +m[2]; pageArgs.splice(i, 2); }
      break;
    }
    var fillWindow = pageArgs.indexOf("-nokeepaspect") !== -1;
    function frameWin() {
      var d = window.devicePixelRatio || 1;
      return [Math.round(frameW / d), Math.round(frameH / d)];
    }
    var emulator = MAMELoader.start({
      canvas: canvas,
      status: status,
      fullscreenElement: screen,
      driver: config.driver,
      cache: config.cache || (CACHE_PREFIX + config.driver),
      files: config.files || [],
      // Pin creation to the frame size (CSS points; backing lands on the
      // frame in device pixels). No -maximize: it would born viewport-sized
      // and snap later.
      args: pageArgs.concat(
        (frameW > 0 && frameH > 0) ? ["-resolution", frameWin().join("x")] : []),
      diffDir: ("diffDir" in config) ? config.diffDir : true,
      cfgDir: config.cfgDir || null,
      nvramDir: config.nvramDir || null,
      bgfxInitialChain: ("bgfxInitialChain" in config)
        ? config.bgfxInitialChain
        : "unfiltered",
      onProgress: function (frac) {
        if (!loadbar) return;
        loadbar.style.display = "block";
        loadbar.firstElementChild.style.width = Math.floor(frac * 100) + "%";
        if (frac >= 1) loadbar.style.display = "none";
      },
    });
    // Pre-size the frame before MAME starts: mirror the display config into
    // the canvas backing now and contain immediately. Boot then lands with
    // no snap; MAME letterboxes the guest inside its own window in this frame.
    if (frameW > 0 && frameH > 0) {
      canvas.width = frameW; canvas.height = frameH;
      containCanvas();
      // Drive MAME's SDL window to the frame size once it exists (creation
      // overwrites canvas.width, clamped to the browser work area when the
      // frame does not fit) so the backing stays exactly on the frame. SDL
      // rounds points*dpr, so accept a one-pixel shortfall when the frame
      // is not divisible by the dpr. The retry budget must not start before
      // the window is born: cold asset loads can take minutes.
      (function () {
        var waits = 0, tries = 0, born = false;
        var poll = setInterval(function () {
          if (fsActive()) return; // fullscreen owns the window while active
          if (!born) {
            if (++waits > 1200) { clearInterval(poll); return; } // 10 min cap
            if (canvas.width !== frameW || canvas.height !== frameH) born = true;
            else return;
          }
          if (++tries > 300) { clearInterval(poll); return; }
          var win = frameWin();
          emulator.resizeBacking(win[0], win[1]);
          if (Math.abs(canvas.width - frameW) <= 1 && Math.abs(canvas.height - frameH) <= 1) clearInterval(poll);
        }, 500);
      })();
    }
    // ---- UI hooks ----
    root.querySelector("#reset").onclick = function () { emulator.softReset(); };
    root.querySelector("#fs-reset").onclick = function () { emulator.softReset(); };
    root.querySelector("#fullscr").onclick = function () { toggleFullscreen(); };
    root.querySelector("#mute").onclick = function () { var m = emulator.toggleMute(); this.textContent = m ? "Unmute" : "Mute"; };
    root.querySelector("#fps").onclick = function () { var f = emulator.toggleShowFps(); this.textContent = f ? "No FPS" : "FPS"; };
    var touchToggle = root.querySelector("#touch-toggle");
    var schemePos = 0; // 0 = none (hidden); 1..schemeOrder.length
    touchToggle.onclick = function () {
      schemePos = (schemePos + 1) % (schemeOrder.length + 1);
      var name = schemeOrder[schemePos - 1] || null;
      if (name) {
        keyCodes = keySchemes[name];
        screen.classList.add("show-touch");
        this.textContent = name.toUpperCase();
      } else {
        keyCodes = defaultKeys;
        screen.classList.remove("show-touch");
        this.textContent = "Controls";
      }
    };
    Array.prototype.forEach.call(root.querySelectorAll("[data-bgfx-chain]"), function (control) {
      control.onclick = function () {
        var current = this;
        current.style.pointerEvents = "none";
        emulator.setBgfxChain(current.getAttribute("data-bgfx-chain")).then(function (chain) {
          if (chain) {
            Array.prototype.forEach.call(root.querySelectorAll("[data-bgfx-chain]"), function (other) {
              other.style.textDecoration = (other === current) ? "none" : "underline";
            });
          }
          current.style.pointerEvents = "";
        });
      };
    });

    function eventKey(code) {
      if (code === "Space") return " ";
      if (code.indexOf("Key") === 0) return code.charAt(3).toLowerCase();
      if (code.indexOf("Digit") === 0) return code.charAt(5);
      return code;
    }
    function sendKeyEvent(type, key) {
      var code = keyCodes[key] || defaultKeys[key];
      if (!code) return;
      var event;
      try {
        event = new KeyboardEvent(type, { key: eventKey(code), code: code, bubbles: true, cancelable: true });
        Object.defineProperty(event, "keyCode", { value: domKeyCodes[code] || 0 });
        Object.defineProperty(event, "which", { value: domKeyCodes[code] || 0 });
      } catch (ignore) { return; }
      (canvas || document).dispatchEvent(event);
    }
    Array.prototype.forEach.call(root.querySelectorAll("#joystick-controls button"), function (button) {
      var key = button.getAttribute("data-joystick-key");
      var press = function (event) {
        event.preventDefault();
        button.setPointerCapture && event.pointerId !== undefined && (function () { try { button.setPointerCapture(event.pointerId); } catch (ignore) {} })();
        button.classList.add("pressed");
        sendKeyEvent("keydown", key);
      };
      var release = function (event) {
        event.preventDefault();
        button.classList.remove("pressed");
        sendKeyEvent("keyup", key);
      };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
      button.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    });
    // NMI is edge-triggered on the F12 port bit; hold it past a frame so a
    // quick tap can't land inside one input poll and vanish.
    var nmiBtn = root.querySelector("#nmi");
    if (nmiBtn) nmiBtn.onclick = function () {
      sendKeyEvent("keydown", "nmi");
      setTimeout(function () { sendKeyEvent("keyup", "nmi"); }, 150);
    };

    // Fast toggles what the PgDn UI key drives underneath (unthrottle +
    // max frameskip) through the runtime bridge. Not a synthetic keypress:
    // UI key handling depends on the UI being armed, and the UI polls the
    // key every frame, so injected key state is fragile.
    var fastBtn = root.querySelector("#fast");
    if (fastBtn) fastBtn.onclick = function () {
      var on = !fastBtn.classList.contains("on");
      fastBtn.classList.toggle("on", on);
      emulator.setFastForward(on);
    };
    // Tape (only when the page mounts a -cassette image): first press plays
    // the tape with fast forward; second press stops both. The bridge
    // restores normal speed by itself when loading ends and notifies us.
    var tapeBtn = root.querySelector("#tape");
    if (tapeBtn) {
      tapeBtn.onclick = function () {
        emulator.toggleCassette(function (playing) {
          tapeBtn.classList.toggle("on", playing);
        });
      };
      emulator.onTapeEnd(function () {
        tapeBtn.classList.remove("on");
      });
    };
    // ---- Canvas display: the display-config frame, set once. Windowed the
    // canvas CSS is frame/dpr points so each backing texel is one device
    // pixel (shrunk only if the viewport is smaller, e.g. phones).
    // Fullscreen also re-renders the guest at the viewport size via
    // resizeBacking (see onFsEvent); exit restores frame.
    function containCanvas() {
      var bw = canvas.width, bh = canvas.height;
      if (!(bw > 0 && bh > 0)) return null;
      var win = (frameW > 0 && frameH > 0) ? frameWin() : [bw, bh];
      var s = Math.min(1, window.innerWidth / win[0], window.innerHeight / win[1]);
      canvas.style.width = Math.floor(win[0] * s) + "px";
      canvas.style.height = Math.floor(win[1] * s) + "px";
      canvas.style.visibility = "visible";
      return true;
    }
    // SDL commits its own canvas style an unpredictable few frames after a
    // resize and can clobber ours. Re-assert for ~3s so the last write is
    // always ours. One pin at a time: a new transition cancels the previous
    // pin, so a quick enter->exit can't leave two intervals fighting over
    // the style (that oscillated the window until the older pin expired).
    var pinTimer = null;
    function pinCanvas(styleFn) {
      if (pinTimer) { clearInterval(pinTimer); pinTimer = null; }
      styleFn();
      var n = 0;
      pinTimer = setInterval(function () {
        styleFn();
        if (++n >= 15) { clearInterval(pinTimer); pinTimer = null; }
      }, 200);
    }
    function fsActive() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement ||
        (screen && screen.classList.contains("fs-fallback")));
    }
    // Touch controls reset when fullscreen is entered (they default off).
    var wasFs = false;
    function resetTouch() {
      schemePos = 0;
      keyCodes = defaultKeys;
      screen.classList.remove("show-touch");
      touchToggle.textContent = "Controls";
    }
    function onFsEvent() {
      var fs = fsActive();
      if (fs === wasFs) return; // fullscreenchange + webkitfullscreenchange both fire
      if (fs) resetTouch();
      wasFs = fs;
      // Inline frame size overrides the fullscreen % rules, so set the fill
      // explicitly (aspect kept by object-fit). Re-render the guest at the
      // fullscreen size like desktop does (finer fractional fit from more
      // target pixels) instead of zooming the windowed backing store;
      // restore the frame backing on exit.
      if (fs) {
        pinCanvas(function () { canvas.style.width = "100%"; canvas.style.height = "100%"; });
        emulator.setKeepAspect(1); // fullscreen: keep aspect
        emulator.resizeBacking(window.innerWidth, window.innerHeight);
      } else {
        if (fillWindow) emulator.setKeepAspect(0); // fill pages: fs kept aspect, exit restores fill
        if (frameW > 0 && frameH > 0) emulator.resizeBacking.apply(emulator, frameWin());
        pinCanvas(containCanvas);
      }
    }
    document.addEventListener("fullscreenchange", onFsEvent);
    document.addEventListener("webkitfullscreenchange", onFsEvent);

    // Browsers without element fullscreen (iOS Safari) get an in-page
    // fallback: same CSS and sizing, driven by class instead of the
    // fullscreen element. Never cede fullscreen to the canvas itself —
    // SDL would fill the screen its own way and hide these controls.
    function toggleFullscreen() {
      var req = screen.requestFullscreen || screen.webkitRequestFullscreen;
      if (req) {
        if (fsActive() && document.exitFullscreen) document.exitFullscreen();
        else req.call(screen);
        return;
      }
      var on = screen.classList.toggle("fs-fallback");
      document.body.classList.toggle("fs-lock", on);
      if (on) {
        resetTouch();
        pinCanvas(function () { canvas.style.width = "100%"; canvas.style.height = "100%"; });
        emulator.setKeepAspect(1); // fullscreen: keep aspect
        emulator.resizeBacking(window.innerWidth, window.innerHeight);
      } else {
        if (fillWindow) emulator.setKeepAspect(0);
        if (frameW > 0 && frameH > 0) emulator.resizeBacking.apply(emulator, frameWin());
        pinCanvas(containCanvas);
      }
      wasFs = on;
    }

    return emulator;
  }

  return { mount: mount };
})();
