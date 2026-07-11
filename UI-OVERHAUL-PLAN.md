# Maverick Voice — Dashboard UI Overhaul Plan

Design audit of the dashboard window (renderer/app + renderer/ui). Scope: UX
and visual system only. The `DESIGN.md` constraints **stay**: monochrome
black/white glass, intent-named tokens, compositor-only motion,
reduced-motion gating, light/dark parity.

**How to read this.** Items are grouped by the seven audit areas and tagged
`[P0]` (quick win, do first) → `[P2]`. Each has: problem, concrete change
(file named), effort **S/M/L**, and risk. IDs (e.g. `IA-1`) let you check
items off; the 3-phase sequence at the end sequences them. No implementation
here — this is decision-ready, not code.

Audited: `DESIGN.md`, `PRD.md`, `tokens.css`, `styles.css`, `ui/ui.css`,
`app/App.tsx`, all 7 pages, all 10 settings sections, `onboarding/*`, `ui/*`.

---

## 0. One bug that gates everything — fix before any visual work

`[P0]` **DESIGN-DEBT** — `renderer/styles/tokens.css` `.glass-card` and
`.glass-pill` ship `backdrop-filter: blur(60px)/blur(40px) saturate(180%)`.
DESIGN.md §3 bans this outright ("No backdrop-filter. Ever." — the single
biggest v1 GPU cost, and it blurs *nothing* on the opaque page). Every card in
the app inherits it. The tokens already make `--surface-glass` 88–90% opaque
so the look survives removal. **Change:** delete both `backdrop-filter`
declarations; keep the glass look from `--surface-glass` + `--stroke` +
`--shadow-raise`. **Effort S. Risk low** (opacity already carries the look;
verify the pill on a busy wallpaper). This unblocks the smoothness the PRD
promises and must land before micro-interaction work.

---

## 1. Information architecture

The sidebar (`app/App.tsx` `TABS`) is **7 flat items**: Home, History,
Dictionary, Replacements, Snippets, Rules, Settings. DESIGN.md §6 specced 5
(Home / History / Dictionary / Snippets / Settings); Replacements and Rules
were added since, so the nav has outgrown its plan.

| ID | Problem | Change (file) | Eff | Risk |
|----|---------|---------------|-----|------|
| `IA-1` `[P0]` | Dictionary, Replacements, Snippets, Rules are one mental model ("teach the app how to hear & shape my words") split across 4 top-level tabs; the list is long and each tab is thin. | Group them under one **"Personalization"** sidebar item that opens a page with a segmented sub-nav (reuse `ui/Segmented`). Sidebar drops 7→4 (Home, History, Personalization, Settings). Keep the 4 page components; only the shell in `App.tsx` changes. | M | Med — re-parents routing/`hidden` sections; keep each page mounted to preserve the no-remount rule. |
| `IA-2` `[P1]` | Tab order is not usage-ordered; the four thin tabs sit between the two daily-use ones (Home, History). | With `IA-1` this resolves. If grouping is deferred, at least reorder: Home, History, then the personalization cluster, then Settings. | S | Low |
| `IA-3` `[P2]` | "Rules" and "Replacements" are opaque labels; users won't guess Rules = AI cleanup, Replacements = text swaps. | Inside the Personalization sub-nav use plain labels: **Words** (Dictionary), **Swaps** (Replacements), **Snippets**, **AI Rules**. | S | Low — copy only. |

---

## 2. Page-level UX

| ID | Problem | Change (file) | Eff | Risk |
|----|---------|---------------|-----|------|
| `PG-1` `[P0]` | `Rules` only take effect "when AI auto-format is on," but that toggle lives in Behavior/Home — a user can build rules that silently do nothing. | In `app/Rules.tsx`, when `settings.autoFormat` is false show an inline notice at the top ("Rules apply only while AI auto-format is on — [Enable]") wired to `update({autoFormat:true})`. | S | Low |
| `PG-2` `[P0]` | `Home.tsx` re-implements provider icons (`ProviderIcon`) and its own `<header>` instead of the shared `ui/ProviderGlyph` and `ui/PageHeader` — a divergent copy that will drift. | Replace inline SVGs with `ProviderGlyph`; replace the bespoke header with `PageHeader`. | S | Low |
| `PG-3` `[P1]` | Empty states are inconsistent: History has icon + keyboard hint; Dictionary/Replacements/Snippets/Rules pass neither, and render *below* the always-present add-form (redundant "nothing here" under a live form). | Give each `EmptyState` an `icon` and (where relevant) a `hint`; consider collapsing the empty state into the form card's helper text so the page isn't two stacked "empty" blocks. | S | Low |
| `PG-4` `[P1]` | Home is a stats/settings mirror, not a dashboard — no path to *act*. First-run users see numbers, not "how do I dictate?". | In `Home.tsx` add a top hero row: current hotkey as a large `Kbd` + one line "Press this anywhere to dictate," and a "Recent" strip (last 3 sessions via `getSessions`, linking to History). Keep the monthly stat card below. | M | Low |
| `PG-5` `[P1]` | Pause-media (F31, a headline v2 feature) is buried as one toggle in `AudioSection` — undiscoverable. | Surface it in Home's quick-toggles card alongside auto-format; keep the canonical control in Audio. | S | Low |
| `PG-6` `[P2]` | Dictionary chips reveal the remove button always at `text-ink-faint`; History/Replacements/Snippets reveal row actions on hover/focus. Two different affordance models. | Pick one row-action model (hover + `focus-within`, already the majority) and apply to Dictionary chips too. | S | Low |
| `PG-7` `[P2]` | Replacements / Snippets / Rules are three near-identical "list of editable rows + add-form" pages with three different form layouts (inline / two-input / stacked). | Extract a shared `ListEditor` row + add-form pattern into `ui/`. Cuts ~200 lines and locks consistency. | L | Med — refactor; behavior (immediate-persist contract) must be preserved verbatim. |

---

## 3. Consistency passes

The token layer is disciplined; the **utility usage on top of it is not.**

| ID | Problem | Change | Eff | Risk |
|----|---------|--------|-----|------|
| `CS-1` `[P1]` | Ad-hoc font sizes across pages: `[10px] [10.5px] [11px] [12px] [12.5px] [13px] [14px] [20px] [22px] [28px]`. `10.5`/`12.5` are one-off. No type scale. | Define a small type scale in `@theme` (e.g. label 11, body 12, item-title 13, h2 22, stat 28) and replace arbitrary `text-[…px]` with it. Kill the half-pixel sizes. | M | Low — visual diffs are tiny; do per-page. |
| `CS-2` `[P1]` | Card padding is inconsistent: `px-5 py-3.5`, `px-4 py-3.5`, `px-4 py-4`, `px-3.5 py-3.5`, `px-3 py-2.5`, `SettingRow` `px-5 py-4`. | Standardize card padding to two tokens (list-row vs content-card) and apply. `SettingRow` becomes the reference for rows. | M | Low |
| `CS-3` `[P2]` | `--ink-faint` (α .32/.34) is used for readable helper text (Dictionary hint, Rules before/after examples) — below the §2 4.5:1 floor. It should be a *decorative* tier only. | Move helper/description text to `--ink-muted`; reserve `--ink-faint` for glyph strokes / disabled. | S | Low — also an a11y fix (see A11Y-3). |
| `CS-4` `[P2]` | Control sizes vary: Add buttons `py-2.5`, KeyCard buttons `py-2`, row delete buttons `h-9 w-9` vs History `h-8 w-8`. | Settle icon-button size (one of 32/36px) and text-button height; apply across History, Replacements, Snippets, Rules, KeyCard. | S | Low |
| `CS-5` `[P2]` | Light-mode parity is structurally solid (no hardcoded hex found in pages), but never verified with blur removed and `--ink-faint` reclassified. | After `DESIGN-DEBT` + `CS-3`, do a light-mode sweep of every page; confirm `--ink`/`--ink-muted` contrast ≥ §2 targets. | S | Low |

---

## 4. Settings length

`settings/Settings.tsx` stacks **10 sections** on one scroll (STT, LLM,
Shortcuts, Audio, Behavior, Appearance, Permissions, Advanced, Privacy, Help).
`SectionCard` already sets `id` + `scroll-mt-6`, so anchors exist — but nothing
navigates to them.

| ID | Problem | Change | Eff | Risk |
|----|---------|--------|-----|------|
| `SET-1` `[P1]` | 10 sections, no way to jump; finding "Permissions" or "Privacy" means scrolling past everything. | Add a sticky left/inline **section nav** (anchor links to the existing `id`s) in `Settings.tsx`. No section rewrites — just a nav list + `scroll-mt` (already present). | M | Low |
| `SET-2` `[P2]` | Cross-section dependencies are invisible: instruction key needs Advanced toggle; Rules/app-aware need Behavior auto-format. Users hunt across sections. | Group related sections and add inline "enable in X" links (Shortcuts already links `#advanced` — extend the pattern). Consider merging Behavior + Audio behaviors that overlap. | S | Low |
| `SET-3` `[P2]` | Provider config is two full sections (STT + LLM) high on the page every visit, even once keys are set. | Collapse each provider section to a one-line summary ("Groq · key saved · Whisper Large v3") that expands on click, using the unified KeyCard underneath. | M | Med — KeyCard state on collapse/expand. |

---

## 5. Onboarding

`onboarding/Onboarding.tsx` is solid (adaptive step-skip, compositor progress
bar, reserved-space Back button). Polish only.

| ID | Problem | Change | Eff | Risk |
|----|---------|--------|-----|------|
| `OB-1` `[P1]` | **Triple** progress indicator: top segmented bars + "N of M" text + bottom dots. Redundant and noisy. | Keep the top bars (they show position best); drop the bottom dot row, or drop the bars and keep dots — one indicator. | S | Low |
| `OB-2` `[P2]` | DESIGN.md §6 specs a **fixed-height content region**; the current region is `overflow-y-auto` flexible, so content height jumps between steps and the footer can shift. | Give the step container a fixed min-height so the footer stays put across steps. | S | Low |
| `OB-3` `[P2]` | Onboarding uses its own KeyCard host (`ProviderKeysStep`) — verify it's the *shared* `ui/KeyCard` (it should be, per A9), not a fork. | Confirm `steps.tsx` imports `ui/KeyCard`; remove any local variant. | S | Low |

---

## 6. Micro-interactions (within DESIGN.md §5)

All must be `transform`/`opacity` only and reduced-motion gated. The app is
currently almost inert on the dashboard (only `.btn-raised:active` translate
and `ui-toggle` knob slide).

| ID | Problem | Change | Eff | Risk |
|----|---------|--------|-----|------|
| `MI-1` `[P1]` | `ui/Segmented` swaps the active pill with no motion — the selection "teleports." | Animate the active thumb with `transform: translateX` behind the labels (compositor-only). Gate on reduced-motion (instant). | M | Low |
| `MI-2` `[P2]` | Sidebar tab activation and card hover have no feedback beyond color. | Add a subtle `transform: translateY(-1px)` / scale on nav-item and card hover; press state on nav-items. `opacity`/`transform` only. | S | Low |
| `MI-3` `[P2]` | Success moments (key Saved, copy-to-clipboard) change text with no affirmation. | Reuse the existing `success-pop` keyframe (already in `tokens.css`, unused on dashboard) on the check glyph in KeyCard and History copy. | S | Low |

---

## 7. Accessibility

DESIGN.md §7 set a good baseline (labeled inputs, `role=switch`,
`focus-within` row actions, global focus ring). Gaps found:

| ID | Problem | Change | Eff | Risk |
|----|---------|--------|-----|------|
| `A11Y-1` `[P0]` | Row-action buttons use `opacity-0` (History, Replacements, Snippets, Rules). They remain in the tab order while invisible — a keyboard user tabs onto controls they can't see. `focus-within` reveals the *group* on focus, but History's buttons lack `focus-visible:opacity-100` on the button itself (Replacements/Snippets/Rules have it — inconsistent). | Standardize: every hover-revealed action also reveals on its own `focus-visible` and via `group-focus-within` (the majority pattern). Fix History to match. | S | Low |
| `A11Y-2` `[P1]` | Settings is a 10-section scroll with no landmark nav / skip — heavy for keyboard + SR users. | `SET-1`'s section nav doubles as the fix; mark sections with `aria-labelledby` pointing at the existing `<h3>`. | S | Low |
| `A11Y-3` `[P1]` | `--ink-faint` text (Dictionary hint, Rules examples, placeholders) fails the §2 4.5:1 contrast floor in both themes. | Same as `CS-3` — reclassify faint as decorative; move readable text to `--ink-muted`. | S | Low |
| `A11Y-4` `[P2]` | Home's monthly stat and provider status dots convey state by a tiny dot + color-adjacent ink tier; SR users get "Connected/Not set" text (good) but the stat card has no grouping/label for SR. | Add `aria-label` summarizing the stat card; ensure provider status is announced as text (already is — verify). | S | Low |
| `A11Y-5` `[P2]` | Onboarding progress is `aria-hidden`; SR users get only "N of M" text with no step name. | Add an `aria-live` step announcement ("Step 3 of 8: Microphone"). | S | Low |

---

## Suggested implementation sequence

**Phase 1 — Foundation & quick wins (1 sitting).** Ship the gating fix and
zero-risk cleanups, verify both themes.
`DESIGN-DEBT` · `PG-1` · `PG-2` · `A11Y-1` · `CS-3`/`A11Y-3` · `IA-2` (if
`IA-1` deferred).

**Phase 2 — Structure.** The re-parenting and consistency work.
`IA-1` + `IA-3` (Personalization cluster) · `SET-1`/`A11Y-2` (settings nav) ·
`CS-1` + `CS-2` (type & spacing scale) · `PG-3` + `PG-5` (empty states,
pause-media surfacing) · `OB-1`.

**Phase 3 — Polish & depth.** Higher-effort refinement once structure is
stable.
`PG-4` (real dashboard Home) · `PG-7` (shared ListEditor) · `SET-2`/`SET-3`
(dependency grouping, collapsible providers) · `MI-1`/`MI-2`/`MI-3`
(micro-interactions) · `OB-2`/`OB-3` · `PG-6` · `CS-4` · `CS-5` · `A11Y-4`/`A11Y-5`.

Rationale: Phase 1 removes the one spec violation and the cheapest UX/a11y
wins with near-zero risk; Phase 2 makes the biggest legibility difference (nav
length, scales, empty states); Phase 3 is refinement that benefits from a
settled structure.
