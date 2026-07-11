# Maverick Voice — Orchestration Backlog

Status board for overnight multi-agent work. Owner: orchestrator session (Claude Code).
Rule: source-changing tasks run in isolated worktrees on `cc-*` branches; test-only and read-only tasks run in the main checkout.

## In flight

| # | Task | Scope | Where | Branch |
|---|------|-------|-------|--------|
| 1 | Unit tests: renderer/ui + Home/History/settingsContext — DONE: 151 tests, 15/17 files 100/100; KeyCard 98.11% branches (dead defensive guard), Home 92.85/86.36 (dead code: unused `fmtSeconds` Home.tsx:40-42, unreachable ProviderIcon fallback :234 — source cleanup candidates) | test files only | main checkout | beta |
| 13 | Perf quick wins: lazy-split App/WidgetApp renderer entry, dynamic-import electron-updater, backgroundThrottling:false on HUD | source | worktree | cc-fix/perf-quick-wins |
| 2 | Unit tests: renderer/widget + ThemeProvider — DONE: 100% lines+branches on all 6 files, 88 tests (recorder.ts 26 incl. stop-timeout/mic-yank, VAD cut, serialization) | test files only | main checkout | beta |
| 3 | Unit tests: renderer/app/settings — DONE: 100% lines+branches on all 13 files, 99 tests. NOTE: vitest.config.ts lacks `test.setupFiles` for @testing-library/jest-dom — each test imports `@testing-library/jest-dom/vitest` manually; consider wiring setupFiles centrally | test files only | main checkout | beta |
| 4 | Unit tests: App/Dictionary/Replacements/Snippets/Rules/onboarding | test files only | main checkout | main |
| 6 | UI polish pass — DONE on pre-v2 base (branch `cc-ui/polish-pass` @ e2b44cc: themed sidebar/shadow/sheen tokens, reduced-motion support, light-theme fixes). Needs port/cherry-pick review against v2; v2 rerun in flight as item 11 | styling/markup | worktree | cc-ui/polish-pass |
| 11 | UI polish pass v2 (rerun of 6 against the 94d1258 v2 tree) | styling/markup | worktree | cc-ui/polish-pass-v2 |
| 7 | Unit tests: electron/ main process + shared/ | test files only | main checkout | main |
| 8 | Feature: History search/filter — DONE but built on pre-v2 base (v0.0.13); branch `cc-feature/history-search` @ 6f452b0 needs a port to the v2 History.tsx before merge | source | worktree | cc-feature/history-search |
| 10 | Windows fixes from audit (mic permission check, Escape leak, PowerShell warm worker, tray/label polish) | source | worktree | cc-fix/windows-p0 |

## Queued (launch as slots free up)

1. **Windows release path** — add `build.publish` (generic provider) + port the Windows CI job forward from legacy/.github/workflows/release.yml. NEEDS USER DECISION: updater feed URL (electron/updater.ts:12 is marked "CONFIRM before release"). Blocked by: user input.
2. **Onboarding delight pass** — animated step transitions, live mic test with waveform preview, celebratory finish (worktree, cc-ui/onboarding-delight). Blocked by: 6 merging (shares CSS tokens).
3. **Keyboard-nav + a11y audit** — full app traversal with focus order, aria-live for HUD state changes, reduced-motion support (worktree, cc-ui/a11y). Blocked by: 6 merging.
4. **HUD widget animation refinement** — state-transition choreography (recording→processing→output), spring easings, CSS only (worktree, cc-ui/hud-motion). Blocked by: 6 merging.
6. **Release hardening** — CI test matrix (macOS + Windows), notarization revisit, auto-update smoke checklist. Blocked by: 5.
7. **Empty-state illustrations** — bespoke SVG art per tab replacing generic glyphs (worktree, cc-ui/empty-states). Blocked by: 6 merging.
8. **Usage insights upgrade** — sparkline of daily dictation minutes, per-model cost breakdown chart in UsageSection (worktree, cc-feature/usage-charts).

## Done

- **12. Startup/perf audit** — 3 actionable wins (now item 13): (a) single 720 KB renderer chunk shared by dashboard+HUD — needs React.lazy split in renderer/main.tsx; (b) electron-updater eagerly imported every boot (ajv/js-yaml/fs-extra/lodash/semver tree) though startUpdater no-ops unpackaged — dynamic-import it (electron/updater.ts:8); (c) HUD window missing `backgroundThrottling: false` (electron/windows/hud.ts:43-46) — occluded/unfocused HUD can throttle rAF/VAD timers to ~1fps. Verified-fine (do not re-audit): HUD pre-created at boot (hotkey latency solid), uiohook lazy-required, providers are thin undici wrappers, no boot sync-fs, @lobehub/icons deep-imported, History capped at 50 rendered/100 stored, VAD loop allocation-free, Waveform rAF torn down when idle, contextIsolation everywhere. Watch-only: SETTINGS_CHANGED re-renders all mounted tabs (fine at current scale). Baselines: main.js 552 KB, renderer 720 KB, css 44 KB.
- **5. Windows compatibility audit** — no code-level P0 in the core dictation loop (win32 seams for keys/paste/media/keys-storage all real). Top findings: (a) no Windows release path — no `.github/workflows` on v2, no `build.publish`, updater feed URL unconfirmed; (b) mic permission hardcoded `granted` on win32 (electron/permissions.ts:31-38) with no remediation link; (c) PowerShell cold-start latency degrades paste + frontmost-app detection (inject.ts, frontmostApp.ts 800ms timeout); (d) Escape leaks to focused app on cancel (win32 hook path); (e) mac-helper binary ships in Windows installer (unscoped extraResources); (f) Home.tsx re-implements key labels and falls back to "Fn" off-mac. Full report retained in orchestrator transcript.
- **9. Docs** — closed without changes: SYSTEM-DESIGN.md + PRD.md already existed in the v2 rewrite commit (94d1258); AGENTS.md + README.md were written concurrently by a parallel session. Note: any doc claiming notarization is off is stale — package.json now has `build.mac.notarize: true`.
