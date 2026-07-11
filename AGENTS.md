# AGENTS.md

Non-obvious rules for AI coding agents working in this repo. Read
`INTERFACES.md` before touching any contract file. Everything here is a
"don't relearn this the hard way" note — it isn't repeated in README.md.

## Contract files are the source of truth

- `shared/ipc.ts` (channel strings), `shared/types.ts` (cross-process
  shapes), and `INTERFACES.md` (module signatures) govern everything. If a
  doc disagrees with `shared/*.ts`, the code wins.
- Never inline an IPC channel string anywhere else — import `IPC.*`.
- Every preload `on*` subscription returns an `Unsubscribe` (`() => void`).
  Renderer code never calls `removeAllListeners`.

## Toolchain

- **npm only.** electron-builder's native-module rebuild step is
  npm-specific — do not add `bun.lock` or run bun install here (v1 shipped
  both a `package-lock.json` and a `bun.lock`, drifting; don't repeat it).
- **Never run `npm run dev` in a headless/CI/agent context.** It spawns a
  real Electron app plus a global key listener (`mac-helper` or
  `uiohook-napi`) that hooks system input. Use `npm run typecheck` and
  `npm run build` to verify instead.

## Do not "clean up" these on sight

- `electron/config.ts` — `TIMEOUTS` and `APP_CONFIG` (chunking thresholds,
  junk-detection pattern) are tuned constants ported from v1 profiling, not
  arbitrary numbers. Changing them is a product decision, not a refactor.
- `electron/prompts/prompts.ts` and `appProfiles.ts` — ported verbatim from
  v1 and tuned (temperatures, wording). Don't rewrite prose or "simplify"
  the prompt strings without an explicit request.
- `CAPS_PAIR_MS`, `DEBOUNCE_MS`, `CHAIN_WINDOW_MS`, etc. in `electron/keys/`
  — event-pairing/debounce heuristics, not timeouts; they intentionally live
  outside `TIMEOUTS`.

## Privacy invariants

- Never log transcript or output text, or key material. `electron/logger.ts`
  mirrors `console.*` to `~/.maverick-voice/logs/` verbatim — anything you
  `console.log` is now on disk for 30 days. Log lengths/ids/stage names only.
- `.env` and `.env.release` must stay in `.gitignore`; `.env.example` stays
  tracked.

## Provider invariants

- Providers never read the key vault — callers (`session/pipeline.ts`)
  inject the key. Don't add vault reads inside `providers/`.
- `AbortError` must re-throw (never swallowed into a fallback string).
- Usage is recorded with the **exact** model string sent to the API — it's
  the join key against `PRICING` in `config.ts`.
- New provider = one file in `providers/stt/` or `providers/llm/` + one
  `.set(...)` line in `providers/registry.ts`. Most LLM providers should be
  a thin `createOpenAICompatibleProvider(...)` call, not a hand-rolled fetch.
- `@lobehub/icons` — import mono icons from their deep path
  (`@lobehub/icons/es/<Name>/mono` or equivalent), never the package barrel.
  The barrel pulls in `antd` and bloats the bundle.

## Platform seams

- Platform branching (`process.platform`, `XDG_SESSION_TYPE`) is confined to
  `electron/keys/`, `electron/output/`, `electron/windows/`, and
  `electron/permissions.ts`. Don't scatter `process.platform` checks
  elsewhere.
- macOS key listening goes through `electron/keys/listenerDarwin.ts`
  (spawns `resources/bin/mac-helper`, a token-based stdout protocol:
  `FN_*`/`CAPS_*`/`RIGHT_OPTION_*`/`MODS:`/`HEALTH`). Windows + Linux go
  through `electron/keys/listenerHook.ts` (`uiohook-napi`). Both feed
  `electron/keys/listener.ts`, which normalizes to the same `KeyEvent` union
  — never branch on platform above that layer.
- `mac-helper` **must** be built universal (arm64 + x86_64). Check
  `scripts/build-mac-helper.js` before changing anything native on macOS —
  it verifies with `lipo -archs` and fails the build if not universal. Don't
  add a shortcut that skips this check.

## Code shape

- Keep files at or under ~400 lines; split along the seams already used
  (one file per IPC domain in `electron/ipc/`, one file per settings section
  in `renderer/app/settings/`, etc.). Don't reintroduce god files.
- Tests are colocated `*.test.ts`/`*.test.tsx` next to their source
  (`vitest.config.ts` only includes `*.test.*` — the legacy `textops.spec.ts`
  assert-based sanity check is deliberately excluded from the vitest run).
  Electron is mocked with `vi.mock(...)` **before** importing the module
  under test, not after.
- `legacy/` is reference-only. Port tuned constants and behavior; never port
  its file structure or god-class shape. Check `LEGACY-ISSUES.md` before
  reusing any v1 logic — it lists the specific bugs each pattern caused.
