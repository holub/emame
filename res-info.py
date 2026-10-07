#!/usr/bin/env python3
"""Suggest display frame size for each driver page from MAME -listxml ground truth.

Rule: take the primary screen (bare tag="screen"; slot screens ignored),
compute the visible area from blanking (hbstart-hbend x vbstart-vbend,
falling back to width x height), then search integer multipliers per axis
within an 800x900 box, retaining 1x when that visible axis already exceeds
its bound. Minimize |aspect - view-aspect|, where view-aspect is the
effective aspect of the driver's boot default view read from the binary
itself (headless Lua dump, one run per driver); fall back to 4:3 when the
driver has no runnable ROMs. Break ties toward fewer pixels. When the
default view is an artwork composite (has_art), integer screen scaling
cannot express its aspect, so fit the view bounds into the box instead,
floored at the screen suggestion so the embedded screen keeps natural size.

Compares against the "-resolution" arg pinned in each .html page (device
pixels).

Views (executable-only, no sources needed):
  res-info.py --views [driver ...]
Runs each driver headless with an inline Lua autoboot script reading
manager.machine.render.targets (view_names/current_view) and prints all
views, marking the boot default. Needs complete ROMs; exits 1 on NOROMS.
"""
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

# machine configurations live in machines.json (run.html renders them);
# keys are page slugs, "driver" inside an entry overrides the slug
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "machines.json")) as _mf:
    MACHINES = json.load(_mf)["machines"]

ROOT = os.path.dirname(os.path.abspath(__file__))
MAME_SRC = os.path.abspath(
    os.environ.get("MAME_SRC") or
    os.path.join(ROOT, "..", "mame"))
# default to the headless js wrapper (the shipped binary — knows every
# driver in the build); $MAME overrides as before
_JS = os.path.join(ROOT, "mame-js")
_NATIVE = os.path.join(MAME_SRC, "mame")
MAME = os.environ.get("MAME", _JS if os.access(_JS, os.X_OK) else _NATIVE)
# optional native binary for boot-time view dumps (the js build cannot
# boot machines without a browser); $MAME_NATIVE overrides
MAME_NATIVE = os.environ.get("MAME_NATIVE", _NATIVE)
MAX_W, MAX_H = 800, 900
TARGET = 4.0 / 3.0


def primary_screen(machine):
    for d in machine.iter("display"):
        if d.get("tag") == "screen":
            return d
    return None


def visible(display):
    w, h = int(display.get("width")), int(display.get("height"))
    try:
        vw = int(display.get("hbstart")) - int(display.get("hbend"))
        vh = int(display.get("vbstart")) - int(display.get("vbend"))
        if vw > 0 and vh > 0:
            return vw, vh
    except (TypeError, ValueError):
        pass
    return w, h


def suggest(vw, vh, target=TARGET):
    best = None
    max_mx = max(1, MAX_W // vw)
    max_my = max(1, MAX_H // vh)
    for mx in range(1, max_mx + 1):
        for my in range(1, max_my + 1):
            w, h = vw * mx, vh * my
            err = abs(w / h - target)
            key = (round(err, 4), w * h)
            if best is None or key < best[0]:
                best = (key, (w, h, mx, my, err))
    return best[1]



def current_marker(current, suggested):
    if current == suggested:
        return "OK"
    cur = re.fullmatch(r"(\d+)x(\d+)", current)
    sug = re.fullmatch(r"(\d+)x(\d+)", suggested)
    if cur and sug:
        cw, ch = map(int, cur.groups())
        sw, sh = map(int, sug.groups())
        if cw > 0 and ch > 0 and sw > 0 and sh > 0 and cw * sh == ch * sw:
            return f"x{cw / sw:g}"
    return current


VIEWS_LUA = """-- dump views of the primary UI target (lowest index): DEFAULT <n>, VIEW <i>|<name>|<aspect>|<bounds>|<art>
local render = manager.machine.render
local ui = nil
for _, t in pairs(render.targets) do
  if t.is_ui_target and (ui == nil or t.index < ui.index) then ui = t end
end
if ui ~= nil then
  print("TARGET " .. ui.index)
  print("DEFAULT " .. ui.view_index)
  local saved = ui.view_index
  local i = 1
  while true do
    local n = ui.view_names[i]
    if n == nil then break end
    ui.view_index = i
    local cv = ui.current_view
    local b = cv.bounds
    print(string.format("VIEW %d|%s|%.4f|%.0fx%.0f|%d", i, n, cv.effective_aspect, b.width, b.height, cv.has_art and 1 or 0))
    i = i + 1
  end
  ui.view_index = saved
end
"""


def rompath():
    """ROM directory for headless runs: $MAME_ROMPATH, else this repository's roms/ directory if present."""
    env = os.environ.get("MAME_ROMPATH")
    if env:
        return env
    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "roms")
    return local if os.path.isdir(local) else None


def driver_views(driver, seconds=5, binary=None):
    """Run the binary headless with VIEWS_LUA; return (default, [(name, aspect, bounds)]) or None."""
    import tempfile
    import shutil
    with tempfile.NamedTemporaryFile("w", suffix=".lua", delete=False) as f:
        f.write(VIEWS_LUA)
        script = f.name
    workdir = tempfile.mkdtemp(prefix="res-info-")
    try:
        env = dict(os.environ, SDL_VIDEODRIVER="dummy", SDL_AUDIODRIVER="dummy")
        # sandbox every writable dir so the run creates nothing in cwd
        cmd = [binary or MAME, driver, "-autoboot_script", script]
        for d in ("cfg", "nvram", "input", "state", "snapshot", "diff",
                  "comment", "share"):
            os.makedirs(os.path.join(workdir, d), exist_ok=True)
            cmd += [f"-{d}_directory", os.path.join(workdir, d)]
        rp = rompath()
        if rp:
            cmd += ["-rompath", rp]
        # -video none: render targets/views exist without a renderer, and the
        # bgfx/opengl probe under dummy SDL can't fail; -noreadconfig: ignore cwd mame.ini
        cmd += ["-video", "none", "-noreadconfig",
                "-str", str(seconds), "-nothrottle", "-sound", "none", "-nomouse"]
        p = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=180, env=env)
        out = p.stdout + p.stderr
        if "Fatal error" in out or "cannot be run" in out:
            return None
        default, views = None, []
        seen = set()
        for line in out.splitlines():
            # some drivers execute the boot script twice; keep first dump
            if line.startswith(("DEFAULT ", "VIEW ")) and line in seen:
                continue
            seen.add(line)
            if line.startswith("DEFAULT "):
                default = int(line.split()[1])
            elif line.startswith("VIEW "):
                idx, name, aspect, bounds, art = line[5:].split("|")
                views.append((name, float(aspect), bounds, int(art),
                              int(idx) == default))
        return (default, views) if views else None
    except subprocess.TimeoutExpired:
        return None
    finally:
        os.unlink(script)
        shutil.rmtree(workdir, ignore_errors=True)

def views_with_fallback(driver):
    """driver_views on the default binary; if it can't run the machine and a
    native binary exists, retry there (the js build can't boot machines)."""
    got = driver_views(driver)
    if (got is None and MAME != MAME_NATIVE
            and os.access(MAME_NATIVE, os.X_OK)):
        got = driver_views(driver, binary=MAME_NATIVE)
    return got

def views_main(drivers):
    failed = False
    for driver in drivers:
        got = views_with_fallback(driver)
        if got is None:
            print(f"{driver}: NOROMS (missing files, machine cannot run)")
            failed = True
            continue
        default, views = got
        print(f"# {driver} default=[{default}]")
        for name, aspect, bounds, art, is_default in views:
            mark = "*" if is_default else " "
            artm = " [art]" if art else ""
            print(f"  {mark} {name} aspect={aspect:.4f} bounds={bounds}{artm}")
    sys.exit(1 if failed else 0)


def default_view(driver):
    """(name, effective_aspect, bounds, has_art) of the boot default view; None if un-runnable."""
    got = views_with_fallback(driver)
    if got is None:
        return None
    for name, aspect, bounds, art, is_default in got[1]:
        if is_default:
            return name, aspect, bounds, art
    return None


def main(slugs):
    for s in slugs:
        if s not in MACHINES:
            sys.exit(f"unknown machine: {s} (not in machines.json)")
    drivers = sorted({MACHINES[s].get("driver", s) for s in slugs})
    root = os.path.dirname(os.path.abspath(__file__))
    xml = subprocess.run([MAME, "-listxml"] + drivers,
                         capture_output=True, text=True, check=True).stdout
    machines = {m.get("name"): m for m in ET.fromstring(xml).iter("machine")}
    slug_width = max((len(s) for s in slugs), default=6)
    fmt = f"%-{slug_width}s  %-9s %-24s  %-8s %-9s %s"
    print(("# " + fmt % ("machine", "visible", "default-view", "aspect",
                         "suggested", "current")).rstrip(), flush=True)
    failed = False
    view_cache = {}
    for slug in slugs:
        entry = MACHINES[slug]
        driver = entry.get("driver", slug)
        machine = machines[driver]
        disp = primary_screen(machine)
        vw, vh = visible(disp)
        if driver not in view_cache:
            view_cache[driver] = default_view(driver)
        dv = view_cache[driver]
        if dv is None:
            vname, frame = "NOROMS->4:3", suggest(vw, vh, TARGET)[:2]
            vaspect = TARGET
        elif dv[3]:
            # artwork default: integer-scaled screen area can't express the
            # composite aspect, so fit the view bounds into the box instead,
            # floored at the screen suggestion so the embedded screen never
            # renders below its natural size (box yields to the floor)
            vname, vaspect = dv[0], dv[1]
            w0, h0 = suggest(vw, vh, vaspect)[:2]
            bw, bh = (int(x) for x in dv[2].split("x"))
            s = max(min(MAX_W / bw, MAX_H / bh), w0 / bw, h0 / bh)
            frame = (max(round(bw * s), w0), max(round(bh * s), h0))
        else:
            vname, vaspect = dv[0], dv[1]
            frame = suggest(vw, vh, vaspect)[:2]
        w, h = frame
        currents = {entry["resolution"]}
        suggested = f"{w}x{h}"
        current_print = ",".join(sorted(current_marker(c, suggested) for c in currents))
        failed |= currents != {suggested}
        print(fmt % (slug, f"{vw}x{vh}", vname, f"{vaspect:.4f}",
                     suggested, current_print), flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    args = sys.argv[1:] or list(MACHINES)
    if "--views" in args:
        args = [a for a in args if a != "--views"] or list(MACHINES)
        views_main(args)
    else:
        main(args)
