# Resolution, aspect and scaling — MAME ground truth and web-front methods

Two parts: what stock MAME (0.289) does with window/resolution/aspect
options — driver-agnostic, verified in `src/emu/render.cpp` — and what
this web front adds on top to get identical results inside a browser.

---

## Part 1 — generic MAME behavior

MAME option semantics: https://docs.mamedev.org/commandline/commandline-all.html#core-video-options
(verbatim behavior verified against `src/emu/render.cpp` in MAME 0.289 — where
the docs are silent, the source below is authoritative).
```
screen bitmap (texture)  ->  layout view bounds  ->  render target
                                                          |
                 visible area <- compute_visible_area() <-+
```

MAME never scales the guest directly to "the resolution you asked for".
It computes a **visible area** inside the render target (the window
backing) according to the scale mode and aspect options, then maps the
screen quad into it. Everything below is `render_target::
compute_visible_area()` (`src/emu/render.cpp`) plus the scale-mode
selection a few hundred lines above it.

### Options that matter

| option | effect |
|---|---|
| `-resolution WxH` | window size at creation (desktop: pixels) |
| `-keepaspect` / `-nokeepaspect` | letterbox to the screen aspect vs stretch-fill the target (startup-only, read once) |
| `-unevenstretch` (default) | allow fractional per-axis scales |
| `-nounevenstretch` | force integer per-axis scales (`SCALE_INTEGER`) |
| `-uesx`, `-uesy` | integer only on X or Y, fractional on the other |
| `-sx N`, `-sy N` | user integer scale for an axis — applies **only** when that axis is integer-scaled |

### Scale mode selection (the if/else-if that surprises people)

```
unevenstretch == 0                     -> SCALE_INTEGER
else uesx                              -> SCALE_FRACTIONAL_X (Y integer)
else uesy                              -> SCALE_FRACTIONAL_Y (X integer)
else auto_stretch_xy (per orientation) -> one axis integer, other fractional
else                                   -> SCALE_FRACTIONAL
```

`SCALE_INTEGER` is reachable **only** with `-nounevenstretch`. There is
no other allowed startup-option combination that integer-scales both
axes.

### The 4:3 assumption and how it participates

- A screen device without an explicit `aspect` in the driver defaults to
  **4:3**. The content's own aspect (e.g. 720x288 = 2.5:1) differs, so
  the guest pixel aspect is `pa = (4/3) / content_aspect` — non-square
  guest pixels are the norm, not the exception.
- `effective_aspect()` is the target aspect adjusted by the target's
  palette/user transform; for plain targets it is the screen aspect
  (4:3 here).
- With `keepaspect` **on**, the visible area is the largest rectangle of
  `effective_aspect()` that fits the target: 4:3 guests get pillar/letter
  bars inside a non-4:3 window.
- Inside `SCALE_INTEGER`, the 4:3 aspect steers the *choice* between
  floor and round: candidates are scored by
  `|aspect_ratio * (aa/bb) - 1|` where
  `aspect_ratio = keepaspect ? (target_w/target_h) * tpa / src_aspect : 1`.
  A fractional b of e.g. 1.875 rounds to 2 because that scores closer to
  the true aspect. So `-nounevenstretch` is not "ignore aspect" — it is
  "integer scales, aspect-guided rounding", and with keepaspect the
  back-propagation `ab *= (bb/ba)` keeps the visible area 4:3.

### Worked examples (tbblue: content 720x288, window 720x576)

| options | result |
|---|---|
| stock (`-unevenstretch`, keepaspect) | visible 720x540, 18px bars top/bottom |
| `-nokeepaspect` | stretch-fill: content scale (1,2), fills exactly |
| `-nounevenstretch` | integer snap to (1,2), fills exactly — identical pixels to `-nokeepaspect` at this window size |
| `-uesx -sy 2` | X fractional, Y forced 2, aspect back-propagates: 768x576 horizontal overscan |
| `-uesy` | Y fractional, X integer 1, 4:3-correct: 720x540 |
| `-nokeepaspect` at 900x720 | stretch-fill (1.25, 2.5) — distorted vs desktop (1,2) |

The equivalence "nokeepaspect == nounevenstretch" holds **only when the
window is an exact multiple of the content**. At any other window size
they differ: integer snap keeps even pixels and centers with bars;
stretch-fill distorts to the window.

### Window creation clamp

At creation the OSD clamps the window to the monitor work area and
enforces the screen aspect (`osd/sdl3/window.cpp`,
`constrain_to_aspect_ratio`). `-resolution` does not bypass it on all
paths; a window born clamped stays clamped. A post-boot
`SDL_SetWindowSize` bypasses the clamp — arbitrary sizes stick.

### Runtime geometry changes

Drivers may call `screen->configure()` at runtime (mode switches), so
the runtime bitmap is not always the `-listxml` width/height/visible
area. A fixed window can be an exact multiple of one mode only.
Example: scorpiongmx base mode 352x296, ext gfx mode 688x320.

---

## Part 2 — what the web front does about it

### Units: CSS points vs device pixels

SDL's emscripten video driver sizes windows in **CSS points** and
multiplies by `devicePixelRatio` for the canvas backing — and the
backing is the render target bgfx renders into. A verbatim
`-resolution 720x576` at dpr 1.25 creates a **900x720** target, and
`-nokeepaspect` stretch-fills it at (1.25, 2.5): visibly distorted
geometry. This, not the aspect math, is why browser output used to
differ from desktop `-nounevenstretch`.

Our rule: **the page's `-resolution WxH` is in device pixels** (desktop
semantics). The theme:

- parses `"-resolution", "WxH"` out of the page `args`, strips it, and
  re-issues it divided by dpr (rounded) so the backing lands exactly on
  WxH at any dpr;
- presizes the canvas backing to WxH before MAME starts;
- sizes the windowed CSS box to WxH/dpr points — one backing texel per
  device pixel (same on-screen size, crisp).

`resizeBacking(w,h)` (loader) means *CSS points* everywhere.

### Boot re-assert poll

Because creation can be clamped to the browser work area (Part 1), the
theme polls after boot: once the SDL window exists, it re-issues
`resizeBacking(frame/dpr)` until the backing matches the frame (±1 for
SDL's rounding when the frame is not divisible by the dpr), capped so
cold multi-minute asset loads cannot exhaust the budget.

### Fullscreen transitions (`resize_window` + `set_keepaspect` bridges)

Pages boot with `-nokeepaspect` for windowed square-pixel fill, but
fullscreen must keep aspect or the image stretches to the viewport.
`-keepaspect` is startup-only, so the theme flips it at runtime through
the emscripten bridge (`JSMAME.set_keepaspect` ->
`emscripten_set_keepaspect` in `src/emu/machine.cpp`, exported via
genie.lua/post.js):

- **fs enter**: `set_keepaspect(1)` + `resizeBacking(innerWidth,
  innerHeight)` — re-render at full viewport resolution, letterboxed
  inside it;
- **fs exit**: `set_keepaspect(0)` (restore fill) +
  `resizeBacking(frame/dpr)` + CSS re-pin — back to the exact frame.

`emscripten_resize_window` (SDL_SetWindowSize) is what makes both the
viewport re-render and the post-clamp correction possible.

### Page policy

- every page lists `"-resolution", "<w>x<h>"` explicitly in `args`
  (device pixels; `validate.py` checks it against the listxml-derived
  suggestion);
- every current page also lists `"-nokeepaspect"`: windowed fill with
  square target pixels, equivalent to desktop
  `-resolution WxH -nounevenstretch` when the resolution is an exact
  multiple of the content (verified pixel-identical for tbblue);
- `-nounevenstretch` and `-view` are **banned** in pages by convention;
- zoom is the page author's business: `resolution = base * k`, crisp at
  integer `k`, uneven at fractional `k`;
- known limitation: scorpiongmx stays at 704x592 (crisp in base
  352x296 mode); its ext gfx mode reconfigures the screen to 688x320 at
  runtime and is inherently fractional in that window.
