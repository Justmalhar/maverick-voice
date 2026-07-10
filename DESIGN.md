# Maverick Voice v2 — Design Document

UI/visual/motion spec for the rewrite. The look **feels the same as v1** —
monochrome liquid-glass, pill HUD, raised glass buttons — rebuilt on a token
system that is theme-correct in both light and dark and animation rules that
never jank. Authoritative for anything visual; `INTERFACES.md` governs code
structure.

---

## 1. Design language

- **Monochrome glass.** No color accents anywhere. Semantic states (recording,
  processing, success, error) are expressed as *intensity tiers* of the ink
  color, never hue. Provider glyphs use mono variants only.
- **Two first-class themes.** Dark is the brand default; light is a peer, not
  an afterthought. Every surface, stroke, shadow, and glow has a value in
  both. `system` follows the OS.
- **3D depth via layered shadows** (outer drop + inset top highlight + inset
  bottom shade) on buttons/keycaps — same recipe as v1, re-tuned per theme
  (v1's dark-tuned `rgba(0,0,0,…)` shadows looked muddy on light).
- Native system fonts. No external font loads. Desktop-only layouts that
  resize gracefully.

## 2. Token system (the core fix)

v1's fatal theming flaw: palette-named tokens (`--mv-white-24`) whose light
theme silently inverted them to black-alpha — unreasonable-about classes, and
dozens of hardcoded hex/rgba leaks in JSX. v2 tokens are **intent-named**,
defined once per theme, and are the ONLY source of color. Rules:

1. No raw hex/rgba in components or utilities — tokens only.
2. Every token defined under both `[data-theme='dark']` and
   `[data-theme='light']`. A token missing a light value fails review.
3. Tailwind v4 `@theme` mirrors the **entire** token set (v1 mirrored a subset,
   creating two styling systems). Components use Tailwind utilities over
   tokens; bespoke CSS only for the glass/keycap recipes.

```css
:root, [data-theme='dark'] {
  /* Surfaces */
  --surface-page:        #0a0a0a;      /* ONE page value (v1 had #000 vs #0a0a0a fighting) */
  --surface-raised:      #141414;
  --surface-glass:       rgba(18,18,18,.88);   /* HUD pill + cards — opaque enough to need NO backdrop blur */
  --surface-veil:        rgba(255,255,255,.06); /* hover washes, list rows */
  --surface-sunken:      rgba(0,0,0,.35);
  /* Ink (text/icon) tiers */
  --ink-strong:  rgba(255,255,255,.96);
  --ink:         rgba(255,255,255,.82);
  --ink-muted:   rgba(255,255,255,.55);
  --ink-faint:   rgba(255,255,255,.32);
  /* Strokes */
  --stroke:        rgba(255,255,255,.12);
  --stroke-strong: rgba(255,255,255,.22);
  /* Depth + glow */
  --shadow-raise:  0 2px 8px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.10), inset 0 -1px 0 rgba(0,0,0,.4);
  --shadow-float:  0 12px 40px rgba(0,0,0,.55);
  --glow-dim:    rgba(255,255,255,.25);   /* dictation recording ring */
  --glow-bright: rgba(255,255,255,.65);   /* instruction recording ring */
  --focus-ring:  rgba(255,255,255,.7);
}
[data-theme='light'] {
  --surface-page:        #f5f5f4;
  --surface-raised:      #ffffff;
  --surface-glass:       rgba(255,255,255,.90);
  --surface-veil:        rgba(0,0,0,.05);
  --surface-sunken:      rgba(0,0,0,.06);
  --ink-strong:  rgba(10,10,10,.96);
  --ink:         rgba(10,10,10,.84);
  --ink-muted:   rgba(10,10,10,.56);
  --ink-faint:   rgba(10,10,10,.34);
  --stroke:        rgba(0,0,0,.10);
  --stroke-strong: rgba(0,0,0,.20);
  --shadow-raise:  0 2px 8px rgba(0,0,0,.10), inset 0 1px 0 rgba(255,255,255,.9), inset 0 -1px 0 rgba(0,0,0,.06);
  --shadow-float:  0 12px 40px rgba(0,0,0,.16);
  --glow-dim:    rgba(0,0,0,.20);
  --glow-bright: rgba(0,0,0,.50);
  --focus-ring:  rgba(0,0,0,.65);
}
```

(Exact values to be tuned during build; the *structure* — names, two full
sets, contrast relationships — is the contract. Contrast: `--ink` on
`--surface-page` ≥ 7:1; `--ink-muted` ≥ 4.5:1, both themes.)

**Component recipes** (`.glass-card`, `.glass-pill`, `.btn-raised`, `.kbd`)
are defined once in a tokens layer and consume only the variables above —
they automatically theme. Toggle knobs, checkmark strokes, waveform bars,
sidebar background: all token-driven (each was a hardcoded light-mode bug
in v1 — LEGACY-ISSUES A10).

### Theme plumbing
`ThemeProvider` sets `data-theme` on `<html>` in **both** roots (dashboard and
HUD). The HUD follows the app theme (v1 forced it dark); its glass token keeps
it legible over any wallpaper in either theme. Setting lives in Settings →
Appearance: System / Light / Dark, persisted via `THEME_SET`, resolved with
`matchMedia('(prefers-color-scheme: dark)')` for `system`.

## 3. Glass without the jank

v1's glassmorphism was implemented with `backdrop-filter: blur(40–60px)` on
every card and on the transparent HUD window — the single biggest GPU cost,
and on the transparent always-on-top HUD window it blurred *nothing* (only
empty web content sits behind the pill). v2 renders the same look for ~free:

- **HUD pill:** `--surface-glass` (88–90 % opaque) + 1px `--stroke` border +
  an inset top highlight + `--shadow-float`. **No backdrop-filter. Ever.** The
  "liquid" quality comes from the highlight gradient and motion, which is what
  users actually perceived in v1.
- **Dashboard cards:** same recipe on the opaque page; `backdrop-filter` is
  permitted only where real content actually scrolls behind a sticky surface
  (e.g. a sticky header), at ≤ 12px blur, and never inside list rows.

## 4. HUD pill spec

- Window: 520×140 transparent frameless always-on-top, click-through outside
  the pill, `showInactive` (never steals focus). Bottom-anchored: work-area
  bottom − pill height − 80 px Dock clearance; centered or right (12 px inset);
  on the **display containing the cursor**. Linux without a compositor:
  transparency unavailable → the pill renders on an opaque rounded
  `--surface-page` canvas (detected at boot, not assumed).
- **One persistent pill element morphs through states** — idle→recording→
  processing→output/fallback/error/too-short/cancelled. Width/state changes
  animate on the same DOM node (transform/opacity crossfade; width via
  `transform: scaleX` on a sized container or animated `max-width` kept under
  120 ms — never per-state DOM swaps). v1's per-state divs caused visible pops.
- State visuals (all ink-tier, both themes):
  - *Recording*: dot pulse + radiating ring — ring is a pseudo-element whose
    `transform: scale` + `opacity` animate (v1 animated `box-shadow` — banned).
    Dictation uses `--glow-dim`, instruction `--glow-bright`. Waveform canvas
    center. Timer text is a memoized leaf. Optional app chip ("Listening · Mail"),
    truncated at 18 chars.
  - *Processing*: shimmer sweep implemented as a translating gradient
    pseudo-element (`transform`, not `background-position`).
  - *Output*: check pop (`scale`+`opacity` spring), brief preview, auto-hide.
  - *Fallback/Error/TooShort*: notice text + subtle shake (`translateX` spring).
  - *Cancelled*: "Cancelled — Undo" with the 3 s undo affordance.
- Enter: rise + fade (~200 ms spring). Exit: sink + fade (~200 ms), then the
  renderer sends `HUD_EXIT_DONE` and main hides the window — no hand-tuned
  timer pairs. The `exiting` flag resets whenever a new show begins (v1's
  stuck-flag flicker bug).
- Sounds: 880/660 Hz start/stop clicks from one reused `AudioContext`,
  honoring the live sound-feedback setting.

## 5. Motion rules (hard constraints)

1. **Compositor-only:** animate `transform` and `opacity` exclusively. Never
   `box-shadow`, `width/height`, `background-position`, `filter`, or layout
   properties. (Kills v1 jank sources C1, and the onboarding width-animated
   progress bar.)
2. **Nothing animates forever while idle.** Pulses/shimmers run only during
   their state; empty-state "breathe" effects are gone.
3. **`prefers-reduced-motion: reduce`** disables all non-essential motion
   globally (one media block in the tokens layer); state changes fall back to
   instant crossfades. v1 had zero support.
4. Springy easing (`cubic-bezier` overshoot) for entries and state pops;
   150–250 ms range; nothing longer than 300 ms except the undo countdown.
5. Timing constants shared renderer↔main only via ack messages, never by
   matching numbers on both sides.

## 6. Dashboard

Same information architecture as v1: sidebar (Home / History / Dictionary /
Snippets / Settings), onboarding flow, tray. Changes:

- Tabs stay mounted — switching is instant (no remount fetch storm, no entry
  animation replay on every click).
- Sidebar, page, and all chrome use surface tokens (no hardcoded `#0a0a0a`).
- Shared primitives everywhere (`ui/` module): one Toggle, one Segmented, one
  KeyCard used by both Settings and Onboarding, one PageHeader/EmptyState.
- Settings sections as separate files; the 103-language list is a data module.
- Onboarding: fixed-height content region, single persistent footer (Back /
  progress dots / Continue), permission steps driven by live preflight, and a
  shortcut step that adapts to detected key capability (no "Press Fn" on
  keyboards without Fn).

## 7. Accessibility (new baseline)

- HUD has `role="status"` + `aria-live="polite"`; state changes announced
  ("Listening", "Thinking", "Pasted", errors); timer has an accessible name.
- No hover-only controls: row actions are visible on `:focus-within` and at
  reduced opacity by default.
- Every input associated with its label (`htmlFor`/`aria-label`); `Segmented`
  is a `radiogroup`; toggles are `role="switch"` with `aria-checked`; all
  buttons `type="button"`.
- Global `:focus-visible` ring via `--focus-ring` (carry over v1's — it was
  good).
- Contrast per §2; verified in both themes.

## 8. Iconography & brand

- App icon / menubar glyph pipeline from `resources/icon-master.png` (single
  1024 master; prefer electron-builder's generation over the Python script if
  parity is achievable). Menubar/tray: template image (darwin) /
  white-on-transparent (win32 + linux StatusNotifier).
- Provider glyphs: `@lobehub/icons` mono base components only — never
  `.Color` variants.
- Keycap (`.kbd`) chips for every shortcut mention, themed via tokens.
